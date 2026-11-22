import type { EditorDef } from './base';
import { assetEditors } from './assets';
import { captureEditors } from './capture';
import { debugEditors } from './debug';
import { homeEditors } from './home';
import { listEditors } from './lists';
import { timeEditors } from './time';
import { commandEditors } from './commands';

/** every editor an area can show, in menu order */
export const EDITORS: EditorDef[] = [...listEditors.slice(0, 3), captureEditors[0], ...timeEditors, ...listEditors.slice(3), ...captureEditors.slice(1), ...assetEditors, ...debugEditors, ...commandEditors, ...homeEditors];
