/* teacher/common.js — 老師後台共用工具 */
(function(){
  var API = window.EDU_API || "https://eduarena-tutoring-production.up.railway.app";
  window.TEACHER_API = API;

  function token(){ return localStorage.getItem("eduarena_teacher_token") || ""; }
  function teacher(){
    try { return JSON.parse(localStorage.getItem("eduarena_teacher") || "null"); }
    catch(e){ return null; }
  }
  function requireLogin(){
    if (!token()) { location.href = "index.html"; return false; }
    return true;
  }
  function logout(){
    localStorage.removeItem("eduarena_teacher_token");
    localStorage.removeItem("eduarena_teacher");
    location.href = "index.html";
  }
  async function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({"Content-Type":"application/json"}, opts.headers || {});
    var t = token();
    if (t) headers["Authorization"] = "Bearer " + t;
    var r = await fetch(API + path, Object.assign({}, opts, { headers: headers }));
    if (r.status === 401) { logout(); throw new Error("unauthorized"); }
    var body = null;
    try { body = await r.json(); } catch(e) {}
    if (!r.ok) {
      var err = new Error((body && body.detail) || ("HTTP " + r.status));
      err.status = r.status; err.body = body;
      throw err;
    }
    return body;
  }
  function toast(msg){
    var el = document.getElementById("t-toast");
    if (!el){
      el = document.createElement("div");
      el.id = "t-toast";
      el.style.cssText = "position:fixed;bottom:40px;left:50%;transform:translateX(-50%);"
        + "background:rgba(20,20,20,.92);color:#fff;padding:12px 22px;border-radius:22px;"
        + "font-size:14px;z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none;"
        + "max-width:82vw;box-shadow:0 6px 22px rgba(0,0,0,.4);";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(function(){ el.style.opacity = "0"; }, 2600);
  }
  window.T = { API: API, token: token, teacher: teacher,
               requireLogin: requireLogin, logout: logout, api: api, toast: toast };
})();
