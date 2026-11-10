/* ============================================================
   Sam · Makefile 程序员 — 站点交互脚本
   运行环境：无构建、无依赖，直接兼容 file:// 协议打开
   模块划分：theme / nav / typed / counters / reveal / make-run / toast
   ============================================================ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Toast ---------- */
  var toastEl = $('#toast');
  var toastTimer = null;

  function showToast(message, duration) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.setAttribute('aria-hidden', 'false');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      toastEl.setAttribute('aria-hidden', 'true');
    }, duration || 3200);
  }

  /* ---------- 1. 主题切换 ---------- */
  var THEME_KEY = 'theme';
  var root = document.documentElement;
  var themeToggle = $('#themeToggle');
  var themeIcon = $('#themeIcon');

  function applyThemeIcon(theme) {
    if (themeIcon) {
      // 图标展示的是「点击后切换到」的主题
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  function currentTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function setTheme(theme, announce) {
    root.setAttribute('data-theme', theme);
    applyThemeIcon(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 隐私模式等场景静默失败 */ }
    if (announce) {
      showToast('$ make theme THEME=' + theme + '  # 主题已切换');
    }
  }

  if (themeToggle) {
    applyThemeIcon(currentTheme());
    themeToggle.addEventListener('click', function () {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });
  }

  /* ---------- 2. 导航：滚动状态 / 移动端菜单 / Scrollspy ---------- */
  var header = $('#siteHeader');
  var burger = $('#navBurger');
  var navLinks = $('#navLinks');
  var backToTop = $('#backToTop');

  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (header) header.classList.toggle('scrolled', y > 12);
    if (backToTop) backToTop.classList.toggle('show', y > 560);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function closeMobileNav() {
    if (!navLinks) return;
    navLinks.classList.remove('open');
    document.body.classList.remove('nav-open');
    if (burger) {
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', '打开菜单');
    }
  }

  if (burger && navLinks) {
    burger.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('open');
      document.body.classList.toggle('nav-open', isOpen);
      burger.setAttribute('aria-expanded', String(isOpen));
      burger.setAttribute('aria-label', isOpen ? '关闭菜单' : '打开菜单');
    });

    // 点击链接后自动收起抽屉
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMobileNav();
    });

    // Escape 收起抽屉
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        closeMobileNav();
        burger.focus();
      }
    });
  }

  if (backToTop) {
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  }

  // Scrollspy：滚动时高亮当前 section 对应的导航项
  var sections = $$('main section[id]');
  var linkForId = {};
  $$('.nav-link').forEach(function (a) {
    var id = (a.getAttribute('href') || '').replace('#', '');
    if (id) linkForId[id] = a;
  });

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        $$('.nav-link').forEach(function (a) { a.classList.remove('active'); });
        var link = linkForId[entry.target.id];
        if (link) link.classList.add('active');
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- 3. Hero 打字机 ---------- */
  var typedEl = $('#typed');
  var TYPED_LINES = [
    '构建系统工程师',
    'Makefile 手艺人',
    '自动化工具链爱好者',
    'make -j$(nproc) 日常患者'
  ];

  function runTypewriter() {
    if (!typedEl) return;
    if (prefersReducedMotion) {
      typedEl.textContent = TYPED_LINES[0];
      return;
    }
    var lineIdx = 0, charIdx = 0, deleting = false;

    (function tick() {
      var line = TYPED_LINES[lineIdx];
      charIdx += deleting ? -1 : 1;
      typedEl.textContent = line.slice(0, charIdx);

      var delay = deleting ? 45 : 110;
      if (!deleting && charIdx === line.length) {
        delay = 2000;                 // 整句停留
        deleting = true;
      } else if (deleting && charIdx === 0) {
        deleting = false;
        lineIdx = (lineIdx + 1) % TYPED_LINES.length;
        delay = 420;                  // 换句前停顿
      }
      setTimeout(tick, delay);
    })();
  }

  /* ---------- 4. 数字滚动 ---------- */
  function animateCounter(el) {
    var target = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (prefersReducedMotion) {
      el.textContent = target.toLocaleString();
      return;
    }
    var duration = 1400;
    var start = null;

    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = Math.round(target * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 5. 滚动进入动画（reveal + 计数器触发） ---------- */
  function setupReveal() {
    var revealEls = $$('.reveal');
    var counterEls = $$('[data-count]');

    if (!('IntersectionObserver' in window) || prefersReducedMotion) {
      revealEls.forEach(function (el) { el.classList.add('visible'); });
      counterEls.forEach(function (el) {
        el.textContent = (parseInt(el.getAttribute('data-count'), 10) || 0).toLocaleString();
      });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });

    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        cio.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    counterEls.forEach(function (el) { cio.observe(el); });
  }

  /* ---------- 6. 彩蛋：$ make run ---------- */
  var runMakeBtn = $('#runMake');
  var makeStatus = $('#makeStatus');

  var MAKE_OUTPUT = [
    '$ make run',
    '→ intro ...',
    '  Hi, I\'m Sam — a Makefile artisan.',
    '→ stack ...',
    '  C/C++ · Go · Python · Shell · CI/CD',
    '→ hire ...',
    '  Open to interesting problems →',
    '[OK] all targets up to date in 0.42s'
  ];

  function runMake() {
    if (!runMakeBtn || runMakeBtn.classList.contains('busy')) return;

    runMakeBtn.classList.add('busy');
    if (makeStatus) { makeStatus.textContent = ''; makeStatus.classList.remove('ok'); }

    var i = 0;
    (function next() {
      if (toastEl) {
        toastEl.setAttribute('aria-hidden', 'false');
        toastEl.classList.add('show');
        toastEl.textContent = MAKE_OUTPUT.slice(0, i + 1).join('\n');
      }
      i += 1;
      if (i < MAKE_OUTPUT.length) {
        setTimeout(next, prefersReducedMotion ? 0 : 260);
        return;
      }
      // 收尾：按钮状态复位 + Toast 自动关闭
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.classList.remove('show');
        toastEl.setAttribute('aria-hidden', 'true');
      }, 3800);
      runMakeBtn.classList.remove('busy');
      if (makeStatus) {
        makeStatus.textContent = '[OK]';
        makeStatus.classList.add('ok');
      }
    })();
  }

  if (runMakeBtn) {
    runMakeBtn.addEventListener('click', runMake);
  }

  /* ---------- 7. 控制台小彩蛋 ---------- */
  try {
    console.log('%c$ make whoami', 'color:#00e19b;font-weight:bold');
    console.log('%c⇒ 你找到了调试入口。想知道彩蛋？试试页面上那个 make run 按钮。', 'color:#8b98a9');
  } catch (e) { /* ignore */ }

  /* ---------- init ---------- */
  runTypewriter();
  setupReveal();
})();
