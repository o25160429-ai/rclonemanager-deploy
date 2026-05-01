(function () {
  const SIDEBAR_KEY = 'sidebar-collapsed';
  let isCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';

  function getEls() {
    return {
      sidebar: document.getElementById('sidebar'),
      mainContent: document.getElementById('mainContent'),
      footer: document.querySelector('.footer'),
      toggle: document.getElementById('sidebarToggle'),
      overlay: document.getElementById('sidebarOverlay'),
      mobileButton: document.getElementById('mobileMenuButton'),
    };
  }

  function applySidebarState() {
    const { sidebar, mainContent, footer, toggle } = getEls();
    if (!sidebar || !mainContent || !footer || !toggle) return;
    const viewportWidth = window.innerWidth;
    const collapsed = viewportWidth < 768 ? false : viewportWidth < 1024 ? true : isCollapsed;
    sidebar.classList.toggle('sidebar--collapsed', collapsed);
    mainContent.classList.toggle('main-content--sidebar-collapsed', collapsed);
    footer.classList.toggle('footer--sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function toggleSidebar() {
    if (window.innerWidth < 768) {
      closeMobileSidebar();
      return;
    }
    isCollapsed = !isCollapsed;
    localStorage.setItem(SIDEBAR_KEY, String(isCollapsed));
    applySidebarState();
  }

  function openMobileSidebar() {
    const { sidebar, overlay } = getEls();
    sidebar?.classList.add('sidebar--mobile-open');
    overlay?.classList.add('sidebar-overlay--visible');
  }

  function closeMobileSidebar() {
    const { sidebar, overlay } = getEls();
    sidebar?.classList.remove('sidebar--mobile-open');
    overlay?.classList.remove('sidebar-overlay--visible');
  }

  function init() {
    const { toggle, overlay, mobileButton } = getEls();
    applySidebarState();
    toggle?.addEventListener('click', toggleSidebar);
    overlay?.addEventListener('click', closeMobileSidebar);
    mobileButton?.addEventListener('click', openMobileSidebar);
    window.addEventListener('resize', applySidebarState);
  }

  window.App = window.App || {};
  window.App.Sidebar = { init, closeMobileSidebar };
})();
