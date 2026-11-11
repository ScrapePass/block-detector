// In a browser extension: add dist/block-detector.js to content_scripts before this file.
// manifest.json: "content_scripts": [{ "matches": ["<all_urls>"], "js": ["block-detector.js", "content.js"] }]
const r = BlockDetector.detect({ expect: ['h1'] });
if (!r.ok) chrome.runtime.sendMessage({ type: 'page-not-ok', reason: r.reason, summary: r.summary });
