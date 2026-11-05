import { ref,onUnmounted } from 'vue';
import { api } from './api';
import { store,changed,refreshConferences } from './store';
import { mergeConferences } from './conference-state';
export function useDeadlineClock(){const now=ref(Date.now());const tick=setInterval(()=>now.value=Date.now(),30000);const refresh=()=>now.value=Date.now();window.addEventListener('focus',refresh);onUnmounted(()=>{clearInterval(tick);window.removeEventListener('focus',refresh);});return now;}
export async function updateConference(c,patch){const saved=await api.patch(`/conferences/${c.key}`,{...patch,base_version:c.version});store.conferences=mergeConferences(store.conferences,store.conferences.map(x=>x.key===saved.key?saved:x));channel?.postMessage('changed');changed();return saved;}

// Other open tabs receive an invalidation, then load the authoritative server state.
let channel = null;
export function listenForConferenceChanges() {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  channel = new BroadcastChannel('research-workspace-conferences');
  channel.onmessage = event => {
    if (event.data === 'changed') refreshConferences({ force: true });
  };
  return () => { channel?.close(); channel = null; };
}
