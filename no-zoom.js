// 鎖死「整頁縮放」：iOS Safari 從 iOS 10 起無視 viewport 的 user-scalable=no /
// maximum-scale，所以雙指還是會把整個網頁放大縮小。純靠 meta 擋不住，要攔 Safari
// 專屬的 gesture 事件。
//
// 注意：這只擋瀏覽器「整頁縮放」。遊戲內村莊/探索地圖的鏡頭 pinch 走的是 Phaser
// 的 pointer 事件（不是 gesture 事件），完全不受影響、照常能縮放。
(function () {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  // 雙擊/連點放大：iOS Safari 連點兩下會放大整頁。touch-action:manipulation 只關掉
  // 「雙擊縮放」，不影響單點/連點/捲動。設在 <html> 即全頁生效（手勢須經根元素，
  // 根不允許雙擊縮放就全頁失效）。遊戲畫布另有 touch-action:none 更嚴格、不受影響。
  try { document.documentElement.style.touchAction = 'manipulation'; } catch (e) {}
})();
