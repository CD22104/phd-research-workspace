import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';
import './themes.css';
import { applySavedTheme } from './lib/theme';

applySavedTheme();

createApp(App).use(router).mount('#app');
