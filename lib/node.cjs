'use strict';
// Node entry: the same API as the browser build, with captcha-detector registered when it is installed,
// so captchas, bot checks and explicit block pages are caught too.
const BlockDetector = require('../dist/block-detector.js');

try {
  BlockDetector.use(require('captcha-detector'));
} catch (_) {
  /* optional */
}

module.exports = BlockDetector;
