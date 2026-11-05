export type ErrorCode =
  | 'cancelled'      // the user stopped it
  | 'crashed'        // the engine's worker died
  | 'memory'         // ran out of memory in the engine
  | 'offline'        // engine isn't cached and there's no network
  | 'corrupt'        // the input could not be decoded
  | 'locked'         // the input is password-protected
  | 'space'          // the disk or the browser's storage quota filled up
  | 'unsupported'    // this browser cannot do it
  | 'mismatch';      // output failed verification, never handed over

export class RebakeError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = 'RebakeError';
  }
}
