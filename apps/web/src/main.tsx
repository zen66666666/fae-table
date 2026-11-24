// 将工作台挂载到浏览器入口，加载统一布局与组件样式。
import { createRoot } from 'react-dom/client';
import { App } from './index.ts';
import './styles.css';
import './components.css';
import './tickets.css';
import './workbench.css';
import './ticket-list.css';
import './ticket-communication.css';

const ROOT_ELEMENT_ID = 'root';
const container = document.getElementById(ROOT_ELEMENT_ID);
if (!container) throw new Error('Missing application root');
createRoot(container).render(<App />);
