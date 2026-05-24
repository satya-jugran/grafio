import type { ClientModule } from '@docusaurus/types';

const clientModule: ClientModule = {
  onRouteUpdate({ location }) {
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'page_view', {
        page_location: window.location.href,
        page_path: location.pathname + location.search + location.hash,
        page_title: document.title,
        send_to: 'G-S9STZBQJXT',
      });
    }
  },
};

export default clientModule;