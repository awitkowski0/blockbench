import { BARS } from "./toolbars";
import { Interface } from "./interface";
import { fs, PathModule, child_process, os, process } from "../native_apis";
import { loadModelFile } from "../io/io";
import { Animation } from "../animations/animation";

const IS_WIN = os.platform() === 'win32';
const CURL = IS_WIN ? 'curl.exe' : 'curl';
const GRADLEW = IS_WIN ? 'gradlew.bat' : './gradlew';

function curlPost(url, body) {
    const dir = (typeof app !== 'undefined' && app.getPath) ? app.getPath('temp') : os.tmpdir();
    const tmp = PathModule.join(dir, `thematic_${Date.now()}.json`);
    fs.writeFileSync(tmp, body, 'utf-8');
    child_process.exec(`${CURL} -s --max-time 0.5 -X POST -H "Content-Type: application/json" -d @${tmp} ${url}`, { env: process.env }, () => {});
    setTimeout(() => { try { fs.unlinkSync(tmp); } catch (e) {} }, 1000);
}

function statusCheck() {
    try {
        child_process.execSync(`${CURL} -s --max-time 2 http://localhost:8000/api/status`, { timeout: 3000, encoding: 'utf-8', env: process.env });
        return true;
    } catch (e) { return false; }
}

let ROOT = (typeof localStorage !== 'undefined' && localStorage.getItem('thematic_project_root')) || '/Users/alexw/IdeaProjects/Thematic-Collections';
const TITLE = 'Thematic Animations';

function setRoot(path) {
    if (!path || !fs.existsSync(path)) return false;
    ROOT = path;
    if (typeof localStorage !== 'undefined') localStorage.setItem('thematic_project_root', path);
    return true;
}

function resolveRootFromPath(filePath) {
    let dir = PathModule.dirname(filePath);
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(PathModule.join(dir, 'settings.gradle')) || fs.existsSync(PathModule.join(dir, 'build.gradle'))) {
            return dir;
        }
        const parent = PathModule.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function armorDir() {
    const d = PathModule.join(ROOT, '@animations', 'armor');
    if (fs.existsSync(d)) return d;
    const d2 = PathModule.join(ROOT, 'src', 'main', 'resources', 'assets', 'thematic', 'animations', 'armor');
    return fs.existsSync(d2) ? d2 : null;
}

function bbPath() {
    const d = armorDir(); return d && fs.existsSync(PathModule.join(d, 'ArmorAnimations.bbmodel')) ? PathModule.join(d, 'ArmorAnimations.bbmodel') : null;
}

function geoDir() {
    if (!ROOT) return null;
    const d = PathModule.join(ROOT, 'src', 'main', 'resources', 'assets', 'thematic', 'geo', 'armor');
    return fs.existsSync(d) ? d : null;
}

function git(args) {
    const r = ROOT; if (!r) return { ok: false, out: '' };
    let cmd = '';
    try {
        cmd = 'git ' + args.map(a => {
            if (typeof a === 'string' && (a.includes(' ') || a.includes('"'))) {
                return IS_WIN ? `"${a.replace(/"/g, '\\"')}"` : `'${a.replace(/'/g, "'\\''")}'`;
            }
            return a;
        }).join(' ');
        const env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' });
        const out = child_process.execSync(cmd, { cwd: r, encoding: 'utf-8', maxBuffer: 10485760, timeout: 30000, env }).trim();
        return { ok: true, out, err: '' };
    } catch (e) { console.error('[Thematic] git error:', cmd, e.stderr || e.message); return { ok: false, out: (e.stdout || '').trim(), err: (e.stderr || e.message || '').trim() }; }
}

function gitFiles() {
    const r = git(['status', '--porcelain']);
    if (!r.ok) return [];
    const dir = armorDir();
    if (!dir) return [];
    let realDir = dir;
    try { realDir = fs.realpathSync(dir); } catch (e) {}
    const rel = PathModule.relative(ROOT, realDir).replace(/\\/g, '/');
    return r.out.split('\n').filter(l => l.trim()).map(l => {
        const raw = l.substring(3).trim();
        const file = raw.includes(' -> ') ? raw.split(' -> ').pop().trim() : raw;
        const st = l.substring(0, 2);
        const status = st.includes('?') ? 'untracked' : st.includes('M') ? 'modified' : st.includes('A') ? 'added' : st.includes('D') ? 'deleted' : st.includes('R') ? 'renamed' : 'changed';
        return { path: file, status, isNew: st === '??' || st.startsWith('A') };
    }).filter(f => f.path.includes(rel));
}

function currentBranch() { const r = git(['rev-parse', '--abbrev-ref', 'HEAD']); return r.ok ? r.out : 'unknown'; }
function baseBranch() { const b = currentBranch(); const i = b.indexOf('-anim/'); return i > -1 ? b.substring(0, i) : b; }

function listAnims() {
    const d = armorDir(); if (!d) return [];
    try {
        return fs.readdirSync(d).filter(f => f.endsWith('.json') && !f.endsWith('.bbmodel')).sort().map(f => ({
            path: PathModule.join(d, f), id: f.replace(/\.(animation\.)?json$/i, ''), type: 'anim',
        }));
    } catch (e) { return []; }
}

function listGeoModels() {
    const d = geoDir(); if (!d) return [];
    try {
        return fs.readdirSync(d).filter(f => f.endsWith('.geo.json')).sort().map(f => ({
            path: PathModule.join(d, f), id: f.replace(/\.geo\.json$/i, ''), type: 'geo',
        }));
    } catch (e) { return []; }
}

function loadGeoModel(fp) {
    try {
        const content = fs.readFileSync(fp, 'utf-8');
        const data = JSON.parse(content);
        if (Codecs && Codecs.bedrock) {
            Codecs.bedrock.load(data, { path: fp, name: PathModule.basename(fp) }, {});
            Blockbench.showQuickMessage('Loaded geo model: ' + PathModule.basename(fp), 3000);
            return true;
        }
    } catch (e) { console.error('Failed to load geo model:', e); }
    return false;
}

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) { return null; } }
function writeJSON(fp, d) { try { fs.writeFileSync(fp, JSON.stringify(d, null, 4), 'utf-8'); return true; } catch (e) { return false; } }

function suitDir() {
    const d = PathModule.join(ROOT, 'src', 'main', 'resources', 'data', 'thematic', 'armors');
    return fs.existsSync(d) ? d : null;
}

function listSuits() {
    const d = suitDir(); if (!d) return [];
    const result = [];
    try {
        const collections = fs.readdirSync(d).filter(f => !f.startsWith('.'));
        for (const col of collections) {
            const colDir = PathModule.join(d, col);
            if (!fs.statSync(colDir).isDirectory()) continue;
            const files = fs.readdirSync(colDir).filter(f => f.endsWith('.json'));
            for (const f of files) {
                const fp = PathModule.join(colDir, f);
                const suit = readJSON(fp);
                result.push({
                    id: f.replace(/\.json$/, ''),
                    collection: col,
                    path: fp,
                    name: (suit && suit.name) || f.replace(/\.json$/, ''),
                    data: suit || {},
                });
            }
        }
    } catch (e) {}
    return result;
}

function availableAbilities() {
    const d = PathModule.join(ROOT, 'src', 'main', 'resources', 'data', 'thematic', 'abilities');
    if (!fs.existsSync(d)) return [];
    try {
        return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => ({
            id: f.replace(/\.json$/, ''), path: PathModule.join(d, f),
        }));
    } catch (e) { return []; }
}

function availableSounds() {
    const d = PathModule.join(ROOT, 'src', 'main', 'resources', 'assets', 'thematic', 'sounds');
    if (!fs.existsSync(d)) return [];
    try {
        return fs.readdirSync(d).filter(f => f.endsWith('.ogg')).sort();
    } catch (e) { return []; }
}

function convertBones(bones) {
    if (!bones) return {};
    const animators = {};
    const groupMap = {};
    if (Group && Group.all) {
        for (const g of Group.all) { groupMap[g.name.toLowerCase().replace(/\.\d+$/, '')] = g.uuid; }
    }
    function findUUID(name) {
        const key = name.toLowerCase().replace(/\.\d+$/, '');
        if (groupMap[key]) return groupMap[key];
        for (const [mk, mu] of Object.entries(groupMap)) { if (mk.includes(key) || key.includes(mk)) return mu; }
        return guid();
    }
    function vec(v, ch) {
        if (Array.isArray(v)) {
            let x = v[0] || 0, y = v[1] || 0, z = v[2] || 0;
            if (ch === 'position') x = -x;
            if (ch === 'rotation') { x = -x; y = -y; }
            return { x, y, z };
        }
        if (v && typeof v === 'object') {
            const p = v.post || v.vector;
            if (Array.isArray(p)) {
                let x = p[0] || 0, y = p[1] || 0, z = p[2] || 0;
                if (ch === 'position') x = -x;
                if (ch === 'rotation') { x = -x; y = -y; }
                return { x, y, z };
            }
            if (p && typeof p === 'object') {
                let x = p.x || 0, y = p.y || 0, z = p.z || 0;
                if (ch === 'position') x = -x;
                if (ch === 'rotation') { x = -x; y = -y; }
                return { x, y, z };
            }
            let x = v.x || 0, y = v.y || 0, z = v.z || 0;
            if (ch === 'position') x = -x;
            if (ch === 'rotation') { x = -x; y = -y; }
            return { x, y, z };
        }
        return { x: 0, y: 0, z: 0 };
    }
    function getDataPoints(source, channel) {
        if (source instanceof Array) {
            return [vec(source, channel)];
        } else if (['number', 'string'].includes(typeof source)) {
            return [{ x: source, y: source, z: source }];
        } else if (typeof source === 'object') {
            const points = [];
            if (source.pre) points.push(vec(source.pre, channel));
            if (source.post) points.push(vec(source.post, channel));
            return points;
        }
        return [{ x: 0, y: 0, z: 0 }];
    }
    for (const [boneName, bd] of Object.entries(bones)) {
        const uuid = findUUID(boneName);
        const kf = [];
        for (const ch of ['rotation', 'position', 'scale']) {
            const gkf = bd[ch];
            if (!gkf) continue;
            if (typeof gkf === 'string' || typeof gkf === 'number' || gkf instanceof Array) {
                kf.push({ time: 0, channel: ch, uniform: !(gkf instanceof Array), data_points: getDataPoints(gkf, ch), interpolation: 'linear' });
                continue;
            }
            if (typeof gkf === 'object' && gkf.post) {
                kf.push({ time: 0, channel: ch, interpolation: gkf.lerp_mode, uniform: !(gkf.post instanceof Array), data_points: getDataPoints(gkf, ch) });
                continue;
            }
            if (typeof gkf === 'object') {
                for (const [ts, kv] of Object.entries(gkf)) {
                    const v = kv.vector || kv;
                    kf.push({ time: parseFloat(ts), channel: ch, interpolation: kv.lerp_mode, uniform: !(kv instanceof Array), data_points: getDataPoints(v, ch) });
                }
            }
        }
        if (kf.length) animators[uuid] = { name: boneName, type: 'bone', rotation_global: false, quaternion_interpolation: false, keyframes: kf };
    }
    return animators;
}

// ── Panel component ──────────────────────────────────────────────

const THEMATIC_STYLES = `
.tm{display:flex;flex-direction:column;height:100%;overflow:hidden;}
.tm-bar{display:flex;gap:4px;flex-wrap:wrap;padding:8px 8px 0 8px;flex-shrink:0;}
.tm-bar button{padding:4px 10px;border:1px solid #555;background:#333;color:#ccc;cursor:pointer;border-radius:3px;font-size:12px;}
.tm-bar button:hover{background:#444;}
.tm-bar .p{background:#1e6f9f;border-color:#1e6f9f;color:#fff;}
.tm-bar .p:hover{background:#2585c0;}
.tm-tabs{display:flex;gap:0;padding:4px 8px 0;flex-shrink:0;}
.tm-tabs .tab{padding:4px 12px;cursor:pointer;border:1px solid #444;border-bottom:none;border-radius:3px 3px 0 0;font-size:12px;color:#888;background:#222;}
.tm-tabs .tab:hover{background:#2a2a2a;}
.tm-tabs .tab.active{background:#333;color:#fff;border-color:#555;}
.tm-s{margin:0 8px;padding:4px 6px;background:#222;border:1px solid #555;color:#ccc;border-radius:3px;flex-shrink:0;}
.tm-l{flex:1;overflow-y:auto;margin:4px 8px;border:1px solid #333;border-radius:3px;min-height:60px;}
.tm-l::-webkit-scrollbar{width:6px;}
.tm-l::-webkit-scrollbar-thumb{background:#444;border-radius:3px;}
.tm-i{display:flex;align-items:center;padding:3px 8px;cursor:pointer;border-bottom:1px solid #2a2a2a;font-size:12px;}
.tm-i:hover{background:#2a2a2a;}
.tm-i.sel{background:#1e3a5f;}
.tm-d{width:8px;height:8px;border-radius:50%;margin-right:6px;flex-shrink:0;}
.tm-d.g{background:#4a4;}.tm-d.y{background:#ea4;}.tm-d.b{background:#4ae;}
.tm-n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;}
.tm-c{font-size:10px;color:#888;margin-left:6px;}
.tm-badge{font-size:9px;padding:1px 4px;border-radius:3px;margin-left:6px;font-weight:600;}
.tm-badge.anim{background:#1a3a5a;color:#6af;}
.tm-badge.geo{background:#3a2a1a;color:#fa6;}
.tm-detail{flex-shrink:0;max-height:200px;overflow-y:auto;}
.tm-x{padding:2px 8px;font-size:12px;display:flex;align-items:center;gap:6px;}
.tm-x input{cursor:pointer;}
.tm-v{display:flex;align-items:center;gap:6px;padding:2px 8px;font-size:12px;}
.tm-v label{width:90px;color:#aaa;flex-shrink:0;font-size:11px;}
.tm-v input[type=range]{flex:1;height:14px;}
.tm-v .vv{width:40px;text-align:right;color:#888;font-size:10px;}
.tm-bot{flex-shrink:0;}
.tm-gf{display:flex;align-items:center;padding:2px 8px;font-size:11px;}
.tm-gf .fp{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aaa;}
.tm-gf .fl{font-size:10px;padding:1px 4px;border-radius:2px;margin-left:6px;color:#6af;}
.tm-gf .fl.n{background:#1a3a5a;}
.tm-gf .fl.m{background:#3a3a1a;color:#fa6;}
.tm-cr{display:flex;gap:4px;padding:4px 8px;}
.tm-cr input{flex:1;padding:3px 6px;background:#222;border:1px solid #555;color:#ccc;border-radius:3px;font-size:12px;}
.tm-cr input:focus{outline:none;border-color:#1e6f9f;}
.tm-cr button{padding:3px 8px;border:1px solid #555;background:#333;color:#ccc;cursor:pointer;border-radius:3px;font-size:11px;white-space:nowrap;}
.tm-cr button:hover{background:#444 !important;}
.tm-ft{font-size:10px;color:#666;border-top:1px solid #333;padding:4px 8px;display:flex;justify-content:space-between;}
.tm-e{padding:12px;text-align:center;color:#666;font-size:12px;}
.tm-lg{font-size:10px;max-height:32px;overflow-y:auto;}
.tm-lg div{color:#555;padding:1px 8px;}
.tm-sep{height:1px;background:#333;margin:4px 8px;}
.tm-hint{font-size:11px;color:#888;padding:4px 8px;text-align:center;font-style:italic;}
.tm-banner{padding:6px 8px;margin:4px 8px 0;border-radius:3px;font-size:11px;text-align:center;background:#1e3a5f;color:#6af;flex-shrink:0}
#animation_toolbar [action="add_animation_controller"],
#animation_toolbar [action="load_animation_file"]{display:none !important}
`;

// CSS is injected in the panel's component, not at module level

BARS.defineActions(function() {

    new Action('thematic-project-open', {
        icon: 'folder_open',
        name: 'Open Thematic Project',
        description: 'Open ArmorAnimations.bbmodel and import all animations from repo',
        category: TITLE,
        click() {
            const bb = bbPath();
            if (!bb) { Blockbench.showMessageBox({ title: 'Error', message: 'ArmorAnimations.bbmodel not found.', icon: 'warning' }); return; }
            Blockbench.read([bb], {}, files => {
                if (files && files[0]) {
                    loadModelFile(files[0]);
                    setTimeout(() => {
                        Blockbench.dispatchEvent('thematic_import');
                    }, 800);
                }
            });
        }
    });

    new Action('thematic-sync', {
        icon: 'sync',
        name: 'Sync Animations from Repo',
        description: 'Pull latest animation files from git and import into project',
        category: TITLE,
        click() {
            const base = baseBranch();
            git(['checkout', base]);
            const r = git(['pull']);
            if (!r.ok) { Blockbench.showMessageBox({ title: 'Error', message: r.err, icon: 'error' }); return; }
            if (!Project || !Project.animations) {
                Blockbench.showMessageBox({ title: 'Error', message: 'Open a project first.', icon: 'warning' });
                return;
            }
            const files = listAnims();
            let added = 0;
            for (const f of files) {
                const data = readJSON(f.path);
                if (!data || !data.animations) continue;
                for (const [name, ad] of Object.entries(data.animations)) {
                    try {
                        let loop = 'once';
                        if (ad.loop === true || ad.loop === 'loop') loop = 'loop';
                        else if (ad.loop === 'hold_on_last_frame') loop = 'hold';
                        const existing = Project.animations.find(a => a.name === name);
                        if (existing) existing.remove();
                        const anim = new Animation({
                            name, length: ad.animation_length || 1, loop,
                            animators: convertBones(ad.bones || {}),
                        }).add();
                        anim.path = f.path;
                        anim.saved = true;
                        anim.calculateSnappingFromKeyframes();
                        anim.setScopeFromAnimators();
                        if (added === 0) anim.select();
                        added++;
                    } catch (e) { console.error('Thematic import error:', name, e); }
                }
            }
            if (added && Timeline && Timeline.update) Timeline.update();
            if (added) Blockbench.showQuickMessage(`Imported ${added} animation(s)`, 3000);
        }
    });

    new Action('thematic-export', {
        icon: 'save',
        name: 'Save Animations to Repo',
        description: 'Export all project animations to .animation.json files',
        category: TITLE,
        click() {
            if (!Project || !Project.animations || !Project.animations.length) {
                Blockbench.showMessageBox({ title: 'Export', message: 'No animations in project.', icon: 'warning' }); return;
            }
            const dir = armorDir();
            if (!dir) { Blockbench.showMessageBox({ title: 'Error', message: 'Repo animations directory not found.', icon: 'error' }); return; }
            const byPath = {};
            for (const a of Project.animations) {
                const k = a.path || (a.name ? (PathModule.join(dir, a.name + '.animation.json')) : null);
                if (!k) continue;
                if (!byPath[k]) byPath[k] = [];
                byPath[k].push(a);
            }
            let c = 0;
            for (const [fp, anims] of Object.entries(byPath)) {
                let out = { format_version: '1.8.0', animations: {} };
                if (fs.existsSync(fp)) {
                    const existing = readJSON(fp);
                    if (existing && existing.animations) out.animations = existing.animations;
                }
                for (const a of anims) {
                    const n = a.name || a.uuid || 'animation';
                    out.animations[n] = {
                        animation_length: a.length || a.animation_length || 1,
                        loop: a.loop || false,
                        bones: a.bones || {},
                    };
                    if (a.thematic) out.animations[n].thematic = a.thematic;
                }
                if (writeJSON(fp, out)) c++;
            }
            if (c) Blockbench.showQuickMessage(`Saved ${c} file(s)`, 3000);
            else Blockbench.showMessageBox({ title: 'Export', message: 'Nothing to save.', icon: 'info' });
        }
    });
});

// ── Panel ────────────────────────────────────────────────────────

Interface.definePanels(function() {

    new Panel('thematic-animations', {
        icon: 'mask',
        name: TITLE,
        condition: { modes: ['edit', 'animate'] },
        default_position: { slot: 'right_bar', sidebar_index: 90, height: 350 },
        growable: true,
        resizable: true,
        component: {
            template: `
<div class="tm">
<div class="tm-bar">
<button class="p" @click="openProject">\u25B6 Open Project</button>
<button @click="saveAnimations">Save Anims</button>
<button @click="newAnim">+ New</button>
<button @click="onTest">\u25B6 Test</button>
<button @click="onKill" style="color:#e55">\u25A0 Kill</button>
<input v-model="projectRoot" @change="updateRoot" placeholder="Project path..." style="flex:1;min-width:120px;padding:3px 6px;background:#222;border:1px solid #555;color:#ccc;border-radius:3px;font-size:10px" :title="projectRoot" />
<label style="font-size:11px;color:#aaa;display:flex;align-items:center;gap:3px;margin-left:auto"><input type="checkbox" v-model="syncPose" style="margin:0" />Sync Pose</label>
</div>
<div class="tm-tabs">
<div class="tab" :class="{active: tab==='files'}" @click="tab='files'">Files ({{ filesCount }})</div>
<div class="tab" :class="{active: tab==='geo'}" @click="tab='geo'">Geo Models ({{ geoCount }})</div>
<div class="tab" :class="{active: tab==='suits'}" @click="tab='suits'">Suits ({{ suitCount }})</div>
</div>
<div v-if="launching" class="tm-banner">{{ launching === 'running' ? '\u25B6 Game running — edit anims, hit play' : '\u23F3 Launching game...' }}</div>

<div v-if="tab==='geo'" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
<input class="tm-s" v-model="search" placeholder="Search..." />
<div class="tm-l">
<div v-if="!filtered.length" class="tm-e">Nothing found</div>
<div v-for="it in filtered" :key="it.id" class="tm-i" :class="{sel: it.path===sel}" @click="pick(it.path)" @dblclick="openFile(it)">
<span class="tm-d" :class="it.gc"></span><span class="tm-n">{{ it.id }}</span>
<span class="tm-badge geo">GEO</span>
</div>
</div>
<div class="tm-hint">Double-click to open in editor</div>
</div>

<div v-if="tab==='files'" class="tm-l">
<div v-if="gits.length">
<div class="tm-gf" style="font-weight:600;border-bottom:1px solid #444;cursor:pointer" @click="toggleAll"><span class="fp"><input type="checkbox" :checked="allChecked" style="margin:0 6px 0 0;vertical-align:middle" />{{ allChecked ? 'Deselect all' : 'Select all' }}</span></div>
<div v-for="f in gits" :key="f.path" class="tm-gf"><span class="fp"><input type="checkbox" :checked="!!checked[f.path]" @change="checked[f.path]=$event.target.checked" style="margin:0 6px 0 0;vertical-align:middle" />{{ f.path }}</span><span class="fl" style="flex-shrink:0">{{ f.status }}</span></div>
</div>
<div v-else class="tm-e">Clean</div>
<div class="tm-sep"></div>
<div class="tm-cr">
<input v-model="cmsg" @keydown.enter="onCommit" placeholder="Commit message..." />
                        <button class="p" @click="onCommit">Commit & Push</button>
                        <button @click="onPull">Pull</button>
                        <button @click="onRevert" style="color:#e55">Revert</button>
</div>
<div class="tm-lg"><div v-for="r in recent" :key="r">{{ r }}</div></div>
<div class="tm-ft"><span>{{ status }}</span><span>{{ branch }}</span></div>
</div>

<div v-if="tab==='suits'" class="tm-l">
<div v-if="!suitEdit">
<input class="tm-s" v-model="suitSearch" placeholder="Search suits..." />
<div v-for="s in filteredSuits" class="tm-i" :key="s.path" @click="openSuit(s)" @dblclick="suitEdit=s">
<span class="tm-n">{{ s.collection }}/{{ s.id }}</span><span class="tm-c">{{ s.name }}</span>
</div>
<div v-if="!filteredSuits.length" class="tm-e">No suits found</div>
</div>
<div v-if="suitEdit" style="display:flex;flex-direction:column;height:100%">
<div class="tm-bar" style="justify-content:space-between">
<span style="color:#aaa;font-size:12px">{{ suitEdit.id }}</span>
<div>
<button @click="suitEdit=null;suitTab='abilities'">Back</button>
<button class="p" @click="saveSuit">Save Suit</button>
</div>
</div>
<div class="tm-tabs">
<div class="tab" :class="{active:suitTab==='abilities'}" @click="suitTab='abilities'">Abilities</div>
<div class="tab" :class="{active:suitTab==='stats'}" @click="suitTab='stats'">Stats</div>
<div class="tab" :class="{active:suitTab==='attributes'}" @click="suitTab='attributes'">Attrs</div>
<div class="tab" :class="{active:suitTab==='tags'}" @click="suitTab='tags'">Tags</div>
<div class="tab" :class="{active:suitTab==='assets'}" @click="suitTab='assets'">Assets</div>
</div>
<div style="flex:1;overflow-y:auto;padding:4px 8px">
<div v-if="suitTab==='abilities'">
<div :key="i" v-for="(ab,i) in (suitEdit.data.abilities||[])" style="margin-bottom:4px;padding:4px;background:#1a1a1a;border:1px solid #333;border-radius:3px">
<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
<input v-model="ab.identifier" placeholder="identifier" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" />
<input v-model="ab.keybind" placeholder="keybind" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" />
<button @click="suitEdit.data.abilities.splice(i,1)">x</button>
</div>
<div v-if="ab._expanded" style="margin-top:3px;padding:4px;background:#151515;border-radius:2px">
<div class="tm-gf" v-for="(f,fi) in (ab._fields||[])" :key="fi" style="margin-bottom:3px;gap:3px">
<input v-model="f.k" placeholder="field" style="width:70px;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:10px" />
<input v-model="f.v" placeholder="value" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:10px" />
<button @click="ab._fields.splice(fi,1)">x</button>
</div>
<button @click="if(!ab._fields)ab._fields=[];ab._fields.push({k:'',v:''})" style="font-size:10px;background:#222;border:1px solid #444;color:#888;padding:1px 4px;margin-bottom:3px">+ Field</button>
<div class="tm-x"><label>Texture:</label><input v-model="ab._texture" placeholder="e.g. thematic:textures/gui/icon.png" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" /></div>
</div>
<button @click="ab._expanded=!ab._expanded" style="font-size:10px;margin-top:2px;width:100%;text-align:center;background:#222;border:1px solid #444;color:#888;padding:1px 4px">{{ ab._expanded ? 'Less' : 'More...' }}</button>
</div>
<button @click="suitEdit.data.abilities=(suitEdit.data.abilities||[]);suitEdit.data.abilities.push({identifier:'',keybind:''})">+ Add</button>
</div>
<div v-if="suitTab==='stats'">
<div class="tm-v" v-for="(v,k) in (suitEdit.data.stats||{})" :key="k"><label>{{ k }}</label><input type="range" min="0" max="100" step="1" v-model.number="suitEdit.data.stats[k]" /><span class="vv">{{ v }}</span></div>
</div>
<div v-if="suitTab==='attributes'">
<div :key="i" v-for="(at,i) in (suitEdit.data.attributes||[])" class="tm-gf">
<input v-model="at.id" placeholder="e.g. pehkui:scale" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" />
<input v-model.number="at.value" type="number" step="0.1" style="width:50px;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" />
<button @click="suitEdit.data.attributes.splice(i,1)">x</button>
</div>
<button @click="suitEdit.data.attributes=(suitEdit.data.attributes||[]);suitEdit.data.attributes.push({id:'',value:0})">+ Add</button>
</div>
<div v-if="suitTab==='tags'">
<div :key="i" v-for="(t,i) in (suitEdit.data.tags||[])" class="tm-gf">
<input v-model="suitEdit.data.tags[i]" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" />
<button @click="suitEdit.data.tags.splice(i,1)">x</button>
</div>
<button @click="suitEdit.data.tags=(suitEdit.data.tags||[]);suitEdit.data.tags.push('')">+ Add</button>
</div>
<div v-if="suitTab==='assets'">
<div class="tm-x"><label>Model:</label><input v-model="suitEdit.data.model" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" /></div>
<div class="tm-x"><label>Texture:</label><input v-model="suitEdit.data.texture" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" /></div>
<div class="tm-x"><label>Geo:</label><input v-model="suitEdit.data.geo" style="flex:1;background:#222;border:1px solid #555;color:#ccc;padding:2px 4px;font-size:11px" /></div>
</div>
</div>
</div>
</div>
</div>`,
            data() {
                return {
                    search: '', sel: null, cmsg: '',
                    status: 'Ready', branch: '', tab: 'geo',
                    items: [], gits: [], recent: [],
                    checked: {}, launching: false, bbProject: null,
                    syncPose: true, _launchInterval: null,
                    projectRoot: ROOT,
                    suits: [], suitSearch: '', suitEdit: null, suitTab: 'abilities',
                };
            },
            computed: {
                filesCount() { return this.gits.length; },
                geoCount() { return this.items.length; },
                suitCount() { return this.suits.length; },
                allChecked() { return this.gits.length > 0 && this.gits.every(f => this.checked[f.path]); },
                filteredSuits() {
                    if (!this.suitSearch) return this.suits;
                    const q = this.suitSearch.toLowerCase();
                    return this.suits.filter(s => s.id && (s.id.toLowerCase().includes(q) || (s.collection && s.collection.toLowerCase().includes(q))));
                },
                filtered() {
                    if (!this.search) return this.items;
                    const q = this.search.toLowerCase();
                    return this.items.filter(i => i.id.toLowerCase().includes(q));
                },
            },
            methods: {
                refresh() {
                    this.branch = currentBranch();
                    const geos = listGeoModels();
                    const gfs = gitFiles();
                    const allSuits = listSuits();
                    this.gits = gfs;
                    this.suits = allSuits;
                    function gc(pid) {
                        const gf = gfs.find(g => g.path.includes(pid));
                        return gf ? (gf.isNew ? 'b' : 'y') : 'g';
                    }
                    this.items = geos.map(g => ({ id: g.id, path: g.path, gc: gc(g.id) }));
                    this.status = `${geos.length} geo models, ${gfs.length} changed`;
                    if (this.launching === 'running') {
                        if (!statusCheck()) this.launching = false;
                    }
                    if (Project) {
                        if (Project.uuid === this.bbProject) {
                            Project.save_path = '';
                            Project.export_path = '';
                        }
                        Project.saved = true;
                        if (Project.animations) {
                            Project.animations.forEach(a => a.saved = true);
                        }
                    }
                },
                pick(fp) {
                    this.sel = fp;
                },
                updateRoot() {
                    const trimmed = (this.projectRoot || '').trim();
                    if (trimmed && trimmed !== ROOT) {
                        if (setRoot(trimmed)) {
                            console.log('[Thematic] Project root updated:', ROOT);
                            this.refresh();
                        } else {
                            console.log('[Thematic] Invalid project path:', trimmed);
                            this.projectRoot = ROOT;
                        }
                    }
                },
                openProject() {
                    const bb = bbPath();
                    if (!bb) { Blockbench.showMessageBox({ title: 'Error', message: 'ArmorAnimations.bbmodel not found.', icon: 'warning' }); return; }
                    const self = this;
                    Blockbench.read([bb], {}, files => {
                        if (files && files[0]) {
                            loadModelFile(files[0]);
                            const detected = resolveRootFromPath(bb);
                            if (detected && detected !== ROOT) {
                                setRoot(detected);
                                self.projectRoot = ROOT;
                                console.log('[Thematic] Auto-detected project root:', ROOT);
                            }
                            setTimeout(() => {
                                if (Project) {
                                    self.bbProject = Project.uuid;
                                    self.syncAnimations();
                                }
                            }, 800);
                        }
                    });
                },
                syncAnimations() {
                    if (!Project || !Project.animations) {
                        Blockbench.showMessageBox({ title: 'Error', message: 'Open a project first.', icon: 'warning' }); return;
                    }
                    const files = listAnims();
                    let added = 0;
                    for (const f of files) {
                        const data = readJSON(f.path);
                        if (!data || !data.animations) continue;
                        for (const [name, ad] of Object.entries(data.animations)) {
                            try {
                                let loop = 'once';
                                if (ad.loop === true || ad.loop === 'loop') loop = 'loop';
                                else if (ad.loop === 'hold_on_last_frame') loop = 'hold';
                                const existing = Project.animations.find(a => a.name === name);
                                if (existing) existing.remove();
                                const anim = new Animation({
                                    name, length: ad.animation_length || 1, loop,
                                    animators: convertBones(ad.bones || {}),
                                }).add();
                                anim.path = f.path;
                                anim.saved = true;
                                anim.calculateSnappingFromKeyframes();
                                anim.setScopeFromAnimators();
                                if (added === 0) anim.select();
                                added++;
                            } catch (e) { console.error(e); }
                        }
                    }
                    if (added && Timeline && Timeline.update) Timeline.update();
                    if (added) {
                        Blockbench.showQuickMessage(`Imported ${added} animation(s)`, 3000);
                        this._lastSync = null;
                        if (BarItems.bring_up_all_animations) BarItems.bring_up_all_animations.trigger();
                    }
                    if (Project) Project.saved = true;
                    this.refresh();
                },
                saveAnimations() {
                    const dir = armorDir();
                    if (!dir) { Blockbench.showMessageBox({ title: 'Error', message: 'Not found.', icon: 'error' }); return; }
                    if (!Project || !Project.animations) { Blockbench.showMessageBox({ title: 'Error', message: 'No animations.', icon: 'warning' }); return; }
                    const byPath = {};
                    for (const a of Project.animations) {
                        if (!a.path) continue;
                        if (!byPath[a.path]) byPath[a.path] = [];
                        byPath[a.path].push(a);
                    }
                    let c = 0;
                    for (const [fp, anims] of Object.entries(byPath)) {
                        let out = { format_version: '1.8.0', animations: {} };
                        if (fs.existsSync(fp)) {
                            const existing = readJSON(fp);
                            if (existing && existing.animations) out.animations = existing.animations;
                        }
                        for (const a of anims) {
                            const n = a.name || a.uuid || 'animation';
                            out.animations[n] = {
                                animation_length: a.length || a.animation_length || 1,
                                loop: a.loop || false,
                                bones: a.bones || {},
                            };
                            if (a.thematic) out.animations[n].thematic = a.thematic;
                        }
                        if (writeJSON(fp, out)) c++;
                    }
                    if (c) Blockbench.showQuickMessage(`Saved ${c} file(s)`, 3000);
                    else Blockbench.showMessageBox({ title: 'Save', message: 'Nothing to save.', icon: 'info' });
                    if (Project) Project.saved = true;
                    // Force instant hot-reload for each saved file
                    for (const fp of Object.keys(byPath)) {
                        const name = PathModule.basename(fp);
                        const content = JSON.stringify(readJSON(fp));
                        const payload = JSON.stringify({ file: name, content });
                        curlPost('http://localhost:8000/api/reload', payload);
                    }
                    this._lastSync = null;
                    this.syncToGame();
                    this.refresh();
                },
                newAnim() {
                    Blockbench.textPrompt('Animation name', '', (n) => {
                        if (!n || !n.trim()) return;
                        const dir = armorDir(); if (!dir) return;
                        const fp = PathModule.join(dir, n.trim() + '.animation.json');
                        if (fs.existsSync(fp)) { Blockbench.showMessageBox({ title: 'Error', message: 'Already exists.', icon: 'warning' }); return; }
                        writeJSON(fp, { format_version: '1.8.0', animations: { [n.trim()]: { animation_length: 1, loop: false, bones: {} } } });
                        this.refresh();
                    });
                },
                openFile(it) {
                    try {
                        const name = it.id;
                        loadGeoModel(it.path);
                        setTimeout(() => this.loadTextures(name), 800);
                    } catch (e) { console.error('openFile error:', e); }
                },

                onCommit() {
                    const msg = this.cmsg.trim();
                    if (!msg) { Blockbench.showMessageBox({ title: 'Error', message: 'Enter a message.', icon: 'warning' }); return; }
                    const selected = this.gits.filter(f => this.checked[f.path]);
                    if (!selected.length) { Blockbench.showMessageBox({ title: 'Error', message: 'No files selected.', icon: 'warning' }); return; }
                    const base = baseBranch();
                    const current = currentBranch();
                    let target = current;
                    if (target === base) {
                        const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                        target = base + '-anim/' + ts;
                        git(['checkout', '-b', target]);
                    }
                    for (const f of selected) {
                        git(['add', '--', f.path]);
                    }
                    const c = git(['commit', '-m', msg]);
                    if (!c.ok) { Blockbench.showMessageBox({ title: 'Error', message: c.err, icon: 'error' }); return; }
                    const pu = git(['push', '--set-upstream', 'origin', target]);
                    if (!pu.ok) { Blockbench.showMessageBox({ title: 'Error', message: pu.err, icon: 'error' }); return; }
                    if (target !== base) git(['checkout', base]);
                    this.cmsg = '';
                    this.checked = {};
                    this.refresh();
                    this.recent.unshift('Pushed: ' + target);
                    this.status = target !== base ? 'Pushed ' + target + ', back on ' + base : 'Pushed ' + target;
                    Blockbench.showQuickMessage('Pushed to ' + target, 3000);
                },
                toggleAll() {
                    const all = this.gits.every(f => this.checked[f.path]);
                    for (const f of this.gits) {
                        if (all) delete this.checked[f.path];
                        else this.checked[f.path] = true;
                    }
                },
                onPull() {
                    if (this.gits.length) {
                        Blockbench.showMessageBox({ title: 'Warning', message: 'You have uncommitted changes. Commit or discard them first.', icon: 'warning' });
                        return;
                    }
                    const base = baseBranch();
                    git(['checkout', base]);
                    const r = git(['pull']);
                    if (!r.ok) { Blockbench.showMessageBox({ title: 'Error', message: r.err, icon: 'error' }); return; }
                    this.refresh();
                    Blockbench.showQuickMessage('Pulled latest from ' + base, 3000);
                },
                onRevert() {
                    const selected = this.gits.filter(f => this.checked[f.path]);
                    if (!selected.length) { Blockbench.showMessageBox({ title: 'Revert', message: 'No files selected.', icon: 'warning' }); return; }
                    const self = this;
                    Blockbench.showMessageBox({
                        title: 'Revert',
                        message: 'Discard all changes in ' + selected.length + ' file(s)?\nThis cannot be undone.',
                        icon: 'warning',
                        buttons: ['Cancel', 'Revert'],
                        cancelIndex: 0,
                    }, function(btn) {
                        if (btn !== 1) return;
                        let ok = 0, fail = 0;
                        for (const f of selected) {
                            if (f.isNew) {
                                try { fs.unlinkSync(PathModule.join(ROOT, f.path)); ok++; } catch (e) { fail++; }
                            } else {
                                const r = git(['checkout', '--', f.path]);
                                if (r.ok) ok++; else fail++;
                            }
                        }
                        self.checked = {};
                        self.refresh();
                        const msg = fail ? 'Reverted ' + ok + ', failed: ' + fail : 'Reverted ' + ok + ' file(s)';
                        self.recent.unshift(msg);
                        self.status = msg;
                        Blockbench.showQuickMessage(msg, 3000);
                    });
                },
                onTest() {
                    const self = this;
                    if (statusCheck()) { self.launching = 'running'; return; }
                    if (self._launchInterval) { clearInterval(self._launchInterval); self._launchInterval = null; }
                    this.launching = true;
                    console.log('[Thematic] Launching game from:', ROOT);
                    Blockbench.showQuickMessage('Launching Minecraft client...', 2000);
                    try {
                        child_process.exec(`${GRADLEW} runClient`, { cwd: ROOT, env: process.env });
                        console.log('[Thematic] Gradle command issued');
                    } catch (e) {
                        console.error('[Thematic] Launch failed:', e.message);
                        this.launching = false;
                        Blockbench.showMessageBox({ title: 'Launch Error', message: 'Failed to start: ' + e.message + '\n\nEnsure the project directory exists:\n' + ROOT, icon: 'error' });
                        return;
                    }
                    let tries = 0;
                    self._launchInterval = setInterval(() => {
                        tries++;
                        const running = statusCheck();
                        console.log(`[Thematic] Waiting for game... try ${tries} running=${running}`);
                        if (running) { clearInterval(self._launchInterval); self._launchInterval = null; self.launching = 'running'; }
                        else if (tries > 300) { clearInterval(self._launchInterval); self._launchInterval = null; self.launching = false; console.log('[Thematic] Game did not start within timeout'); }
                    }, 2000);
                },
                onKill() {
                    console.log('[Thematic] Killing game...');
                    if (this._launchInterval) { clearInterval(this._launchInterval); this._launchInterval = null; console.log('[Thematic] Stopped launch polling'); }
                    try {
                        if (IS_WIN) {
                            child_process.execSync('taskkill /F /IM java.exe 2>nul', { timeout: 5000, encoding: 'utf-8', env: process.env });
                        } else {
                            child_process.execSync("pkill -f 'gradlew runClient' || pkill -f 'minecraft.client.main.Main'", { timeout: 5000, encoding: 'utf-8', env: process.env });
                        }
                        this.launching = false;
                        console.log('[Thematic] Game killed');
                        Blockbench.showQuickMessage('Game killed', 2000);
                    } catch (e) { this.launching = false; console.log('[Thematic] Kill result:', e.message); }
                },
                syncToGame() {
                    if (!Animation || !Animation.selected || !Timeline) return;
                    const anim = Animation.selected;
                    const data = JSON.stringify({
                        name: anim.name,
                        time: Math.round(Timeline.time * 100) / 100,
                        playing: Timeline.playing || false,
                        speed: anim.animation_speed || Timeline.speed || 1,
                        loop: anim.loop || 'once',
                        syncPose: this.syncPose,
                    });
                    if (data === this._lastSync) return;
                    this._lastSync = data;
                    curlPost('http://localhost:8000/api/animation', data);
                },
                openSuit(s) {
                    this.suitEdit = JSON.parse(JSON.stringify(s));
                    if (this.suitEdit.data.abilities) {
                        for (const ab of this.suitEdit.data.abilities) {
                            ab._expanded = false;
                            ab._fields = ab.options && ab.options.fields ? Object.entries(ab.options.fields).map(([k, v]) => ({k, v})) : [];
                            ab._texture = ab.assets && ab.assets.texture ? ab.assets.texture : '';
                        }
                    }
                },
                saveSuit() {
                    if (!this.suitEdit) return;
                    const data = {};
                    if (this.suitEdit.data.abilities && this.suitEdit.data.abilities.length) {
                        data.abilities = this.suitEdit.data.abilities.filter(a => a.identifier).map(a => {
                            const obj = { identifier: a.identifier, keybind: a.keybind };
                            if (a._fields && a._fields.some(f => f.k)) {
                                const fields = {};
                                for (const f of a._fields) {
                                    if (f.k) fields[f.k] = f.v || '';
                                }
                                obj.options = { fields };
                            }
                            if (a._texture) {
                                if (!obj.assets) obj.assets = {};
                                obj.assets.texture = a._texture;
                            }
                            return obj;
                        });
                    }
                    if (this.suitEdit.data.stats && Object.keys(this.suitEdit.data.stats).length) {
                        data.stats = {};
                        for (const k in this.suitEdit.data.stats) {
                            if (this.suitEdit.data.stats[k] !== undefined) data.stats[k] = this.suitEdit.data.stats[k];
                        }
                    }
                    if (this.suitEdit.data.attributes && this.suitEdit.data.attributes.length) data.attributes = this.suitEdit.data.attributes.filter(a => a.id);
                    if (this.suitEdit.data.tags && this.suitEdit.data.tags.length) data.tags = this.suitEdit.data.tags.filter(Boolean);
                    if (this.suitEdit.data.model) data.model = this.suitEdit.data.model;
                    if (this.suitEdit.data.texture) data.texture = this.suitEdit.data.texture;
                    if (this.suitEdit.data.geo) data.geo = this.suitEdit.data.geo;
                    const fp = this.suitEdit.path;
                    if (writeJSON(fp, data)) {
                        Blockbench.showQuickMessage('Saved ' + this.suitEdit.id, 2000);
                        this.refresh();
                    }
                },
                loadTextures(geoName) {
                    if (!Project || !geoName) return;
                    const texDir = PathModule.join(ROOT, 'src', 'main', 'resources', 'assets', 'thematic', 'textures', 'armor');
                    if (!fs.existsSync(texDir)) return;
                    const names = [geoName + '.png', geoName + '_shiny.png'];
                    for (const n of names) {
                        const p = PathModule.join(texDir, n);
                        if (!fs.existsSync(p)) continue;
                        if (Texture.all && Texture.all.find(t => t.name === n)) continue;
                        try {
                            const tex = new Texture({ name: n }).fromFile({ name: n, path: p }).add(false, true);
                            tex.saved = true;
                            Blockbench.showQuickMessage('Loaded texture: ' + n, 1500);
                        } catch (e) { console.error('Texture load error:', e); }
                    }
                },
            },
            created() {
                this.refresh();
                console.log('[Thematic] Panel created, ROOT:', ROOT);
                if (!Project) {
                    setTimeout(() => this.openProject(), 300);
                }
                if (statusCheck()) {
                    this.launching = 'running';
                    console.log('[Thematic] Game already running on localhost:8000');
                } else { console.log('[Thematic] No game running on localhost:8000'); }
            },
            mounted() {
                const self = this;
                if (!window.__thematic_css) {
                    window.__thematic_css = true;
                    Blockbench.addCSS(THEMATIC_STYLES);
                }
                Blockbench.on('thematic_import', () => {
                    setTimeout(() => self.syncAnimations(), 300);
                });
                setInterval(() => this.refresh(), 8000);
                setInterval(() => self.syncToGame(), 100);
                if (Project && Project.animations && !Project.animations.length) {
                    setTimeout(() => this.syncAnimations(), 500);
                }
            },
        },
    });
});
