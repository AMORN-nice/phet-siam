# Builds a self-contained hot-seat trial of the game (no server) into the given output folder.
# Usage: python3 scripts/build-trial.py OUT_DIR
import os, re, shutil, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1]
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(os.path.join(root, 'public', 'assets'), os.path.join(out, 'assets'))
for f in ('style.css', 'sfx.js', 'app.js'):
    shutil.copy(os.path.join(root, 'public', f), os.path.join(out, f))

data = open(os.path.join(root, 'server', 'data.js')).read()
rules = open(os.path.join(root, 'server', 'rules.js')).read()
bundle = (
    "(function(){var module={exports:{}};\n" + data + "\nwindow.__data=module.exports;})();\n"
    "(function(){var require=function(){return window.__data;};var module={exports:{}};\n" + rules +
    "\nwindow.Rules=module.exports;})();\n"
)
open(os.path.join(out, 'rules.js'), 'w').write(bundle)
shutil.copy(os.path.join(root, 'scripts', 'trial-shim.js'), os.path.join(out, 'shim.js'))

html = open(os.path.join(root, 'public', 'index.html')).read()
setup = '''<section id="home" class="screen">
  <div class="home-card lacquer">
    <h1 class="title">เพชรสยาม</h1>
    <p class="sub">โหมดทดลองเล่น: ผลัดกันเล่นบนจอนี้ ยังไม่ได้ต่อออนไลน์</p>
    <label class="field">จำนวนผู้เล่น
      <select id="trialCount" class="trial-select">
        <option value="2">2 คน</option><option value="3" selected>3 คน</option>
        <option value="4">4 คน</option><option value="5">5 คน</option>
      </select>
    </label>
    <div id="trialNames" class="trial-names"></div>
    <fieldset class="theme-pick">
      <legend>ธีม</legend>
      <label class="theme-opt"><input type="radio" name="theme" value="siam" checked><img src="assets/siam/card-1-red.png" alt=""><span>สยามโบราณ</span></label>
      <label class="theme-opt"><input type="radio" name="theme" value="fantasy"><img src="assets/fantasy/card-1-red.png" alt=""><span>แฟนตาซี</span></label>
      <label class="theme-opt"><input type="radio" name="theme" value="scifi"><img src="assets/scifi/card-1-red.png" alt=""><span>ไซไฟอวกาศ</span></label>
    </fieldset>
    <button id="trialStart" class="btn primary">เริ่มเล่น</button>
    <div hidden><input id="nameInput"><input id="codeInput"><button id="createBtn"></button><button id="joinBtn"></button><div id="claimBox"></div></div>
    <p id="homeErr" class="err" role="alert"></p>
  </div>
</section>'''
html = re.sub(r'<section id="home".*?</section>', setup, html, flags=re.S)
html = html.replace('<script src="/socket.io/socket.io.js"></script>',
                    '<script src="rules.js"></script>\n<script src="shim.js"></script>')
html = html.replace('<title>เพชรสยาม</title>', '<title>เพชรสยาม (ทดลองเล่น)</title>')
html = html.replace('</body>', '''<script>
(function () {
  var defaults = ['ต้น', 'ฝน', 'มิ้นท์', 'บอส', 'เอิร์ธ'];
  var box = document.getElementById('trialNames'), count = document.getElementById('trialCount');
  function draw() {
    var n = +count.value, old = Array.from(box.querySelectorAll('input')).map(function (i) { return i.value; });
    box.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var inp = document.createElement('input');
      inp.maxLength = 16; inp.value = old[i] || defaults[i];
      inp.setAttribute('aria-label', 'ชื่อผู้เล่นคนที่ ' + (i + 1));
      box.appendChild(inp);
    }
  }
  count.addEventListener('change', draw); draw();
  document.getElementById('trialStart').addEventListener('click', function () {
    var names = Array.from(box.querySelectorAll('input')).map(function (i, k) { return i.value.trim() || defaults[k]; });
    var t = document.querySelector('input[name="theme"]:checked');
    window.Trial.start(names, t ? t.value : 'siam');
  });
})();
</script>
</body>''')
open(os.path.join(out, 'index.html'), 'w').write(html)

css = open(os.path.join(out, 'style.css')).read()
css += '''
.trial-select { width: 100%; padding: 10px 12px; color: var(--cream); background: var(--lacquer-2); border: 2px solid var(--gold-dim); font: inherit; }
.trial-names { display: grid; gap: 6px; margin-bottom: 14px; }
'''
open(os.path.join(out, 'style.css'), 'w').write(css)
print('built', out)
