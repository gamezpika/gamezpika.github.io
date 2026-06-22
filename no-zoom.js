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
})();
