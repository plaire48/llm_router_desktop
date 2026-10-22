// Host setup for pages that render Desktop UI with the Desktop stylesheets but without the renderer or Workbench
// (test fixtures). The renderer and Workbench call installShellState themselves; repeated installs share one observer.
import {installShellState} from './shell-state.mjs';
if(typeof document!=='undefined')installShellState(document);
