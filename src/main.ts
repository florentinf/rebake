import './ui/styles.css';
import { startApp } from './ui/app';

startApp();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // The app works without it. Only offline use is lost.
  });
}
