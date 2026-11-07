import type { Plugin } from 'vite';
import { FORMATS } from '../src/core/formats';
import { allLinks, linkLine, pagePath } from '../src/core/links';
import { TABLE } from '../src/core/table';
import { GROUPS } from '../src/ui/format-index';

const ORIGIN = 'https://rebake.app';
const SOURCE = 'https://github.com/florentinf/rebake';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const swap = (html: string, from: string | RegExp, to: string) => {
  if (!(typeof from === 'string' ? html.includes(from) : from.test(html))) throw new Error(`pages: ${from} not found in index.html`);
  return html.replace(from, () => to);
};

/** index.html with this page's title, description and URL. */
function withHead(html: string, title: string, description: string, path: string) {
  let page = swap(html, /<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  page = swap(page, /<meta name="description" content=".*?" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  const tags = {
    'og:type': 'website', 'og:site_name': 'rebake', 'og:locale': 'en_US',
    'og:title': title, 'og:description': description, 'og:url': `${ORIGIN}${path}`,
    'og:image': `${ORIGIN}/social.png`, 'og:image:width': '1200', 'og:image:height': '630',
    'og:image:alt': 'rebake — Convert files without sending them anywhere.',
  };
  const social = Object.entries(tags).map(([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}" />`).join('\n    ');
  return swap(page, '</title>', `</title>\n    <link rel="canonical" href="${ORIGIN}${path}" />\n    ${social}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${ORIGIN}/social.png" />
    <meta name="twitter:image:alt" content="rebake — Convert files without sending them anywhere." />`);
}

/** A page with no app in it: shares the stylesheet, loads no script. */
function textPage(html: string, title: string, description: string, path: string, body: string) {
  const head = withHead(html, title, description, path).replace(/\s*<script type="module".*?<\/script>/, '').replace(/\s*<link rel="modulepreload".*?>/g, '');
  return swap(head, /<body[^>]*>[\s\S]*<\/body>/, `<body>\n    <div class="page text-page">\n      <header class="mark"><a href="/">rebake</a></header>\n      <main class="prose">\n${body}\n      </main>\n    </div>\n  </body>`);
}

const PRIVACY = `        <h1>Your files never leave your device.</h1>
        <p>Many online converters send your file to their server, convert it there and send it back. Here the work happens in your browser instead, so your files stay on your phone or computer. All your browser downloads is rebake's own code.</p>
        <h2>How to check</h2>
        <ul>
          <li>Convert a file, turn on airplane mode, then convert another file of the same type. It still works, because the work happens on your device.</li>
          <li>If you know your browser's developer tools, open the Network tab and convert a file. The only requests you'll see are for rebake's own code.</li>
          <li>The site's Content-Security-Policy header only lets the page talk to rebake's own site, and that site has no way to receive files.</li>
        </ul>
        <h2>What gets saved</h2>
        <p>Your last format and your settings, so they're still there next time. They stay in this browser. There are no logs, no analytics and no cookies.</p>
        <h2>What Cloudflare sees</h2>
        <p>Cloudflare hosts rebake, so it sees your IP address and which pages you open, like the host of any website. It never sees your files, and neither does rebake.</p>
        <h2>The code is public</h2>
        <p>It's open source under the MIT licence, so anyone can read how it works: <a href="${SOURCE}">${SOURCE.replace('https://', '')}</a>. The libraries it uses have their own <a href="/third-party-licenses.txt">licences</a>.</p>
        <p>Questions? Email <a href="mailto:contact@florentinf.dev">contact@florentinf.dev</a></p>`;

const SUPPORT = `        <h1>Report a problem</h1>
        <p>Nothing is sent automatically. Email us privately with only the details you choose to share. You can review and edit your message before sending it.</p>
        <h2>What helps</h2>
        <ul><li>The formats you were converting, such as HEIC to JPG.</li>
        <li>What you expected and what happened instead.</li>
        <li>Your browser and device, and any relevant options.</li>
        <li>The error message, with filenames or personal details removed.</li></ul>
        <p>Please do not attach private files or include sensitive information. We can usually start with a description.</p>
        <p><a href="mailto:contact@florentinf.dev?subject=rebake%20problem&amp;body=${encodeURIComponent('Conversion (for example, HEIC to JPG):\nBrowser and device:\nWhat I expected:\nWhat happened:\nError message (remove personal details):\n')}">Write an email</a></p>
        <p>No email app configured? Write to <a href="mailto:contact@florentinf.dev">contact@florentinf.dev</a> using your usual email service. Your email provider handles the message you send.</p>
        <p><a href="/">Back to rebake</a> · <a href="/privacy">Privacy</a></p>`;

const NOT_FOUND = `        <h1>Not found</h1>
        <p><a href="/">Back to rebake</a></p>`;

/** The static pages: one per routing-table row, then privacy, 404, sitemap and robots. */
export function pages(): Plugin {
  return {
    name: 'rebake-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('pages: no index.html in the bundle');
      const original = String(index.source);
      const rows = GROUPS.map(([title, formats]) => `<div class="ix-row"><span class="ix-title">${title}</span><div class="ix-list">${formats.map(from => `<a class="format" href="${pagePath({ from, to: TABLE[from]!.targets[0]! })}">${FORMATS[from].label}</a>`).join('')}</div></div>`).join('');
      const html = original.replace('<p class="lookup" id="lookup"></p>', `<p class="lookup" id="lookup"></p>${rows}`);
      index.source = withHead(html, 'rebake · free private file converter', 'Convert images, video, audio, documents and data without sending them anywhere. Free and open source.', '/');
      const emit = (fileName: string, source: string) => this.emitFile({ type: 'asset', fileName, source });

      const paths = ['/', '/privacy', '/support'];
      for (const link of allLinks()) {
        const path = pagePath(link);
        const from = FORMATS[link.from].label;
        const to = FORMATS[link.to].label;
        let page = withHead(html, `${from} to ${to} converter · rebake`, linkLine(link), path);
        page = swap(page, 'class="route" id="title" tabindex="-1" hidden>', 'class="route" id="title" tabindex="-1">');
        page = swap(page, '<span id="from"></span>', `<span id="from">${escapeHtml(from)}</span>`);
        page = swap(page, '<span id="to" class="to"></span>', `<span id="to" class="to">${escapeHtml(to)}</span>`);
        const prompt = `Drop ${escapeHtml(from)} files`;
        // The route is this page's heading, so the zone's prompt steps down to a paragraph.
        page = swap(page, '<h1 class="zone-title" id="zone-title">Drop files to convert</h1>', `<p class="zone-title" id="zone-title">${prompt}</p>`);
        page = swap(page, 'id="negative-title">Drop files to convert<', `id="negative-title">${prompt}<`);
        emit(`${path.slice(1)}.html`, page);
        paths.push(path);
      }

      emit('support.html', textPage(html, 'Report a problem · rebake', 'Contact rebake privately. Nothing is sent automatically; choose what to share.', '/support', SUPPORT));
      emit('privacy.html', textPage(html, 'Privacy · rebake', 'How rebake converts files without sending them anywhere, and how to check it yourself.', '/privacy', PRIVACY));
      emit('404.html', textPage(html, 'Not found · rebake', 'This page does not exist.', '/404', NOT_FOUND).replace(/\s*<link rel="canonical".*?>/, '').replace('</head>', '<meta name="robots" content="noindex" /></head>'));
      emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`).join('\n')}\n</urlset>\n`);
      emit('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
    },
  };
}
