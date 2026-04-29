import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.scss';

function openOptionsPage() {
   if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
   }

   chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') });
}

function App() {
   return (
      <main className="popup">
         <div>
            <p className="eyebrow">Instagram Downloader</p>
            <h1>Settings moved to a full page</h1>
            <p className="lede">Use the wider configuration page for buttons, filenames, video controls, and Threads settings.</p>
         </div>

         <button className="primary" type="button" onClick={openOptionsPage}>
            Open Settings
         </button>

         <a
            className="source"
            target="_blank"
            rel="noopener,noreferrer"
            href="https://github.com/fajarmf10/instagram-download-browser-extension"
         >
            View Source
         </a>
      </main>
   );
}

createRoot(document.getElementById('root')!).render(
   <React.StrictMode>
      <App />
   </React.StrictMode>
);
