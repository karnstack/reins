// reins background service worker — M0 stub.
// M1 adds the offscreen-held WS client + chrome.debugger bridge.
chrome.runtime.onInstalled.addListener(() => {
  console.log("[reins] extension installed");
});
