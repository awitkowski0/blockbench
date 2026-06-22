import { BARS } from "./toolbars";
import { Interface } from "./interface";
import { fs, PathModule, child_process, shell } from "../native_apis";

const ROOT = '/Users/alexw/IdeaProjects/Thematic-Collections';
const TITLE = 'Thematic Animations';

function armorDir() {
    const d = PathModule.join(ROOT, '@animations', 'armor');
    if (fs.existsSync(d)) return d;
    const d2 = PathModule.join(ROOT, 'src', 'main', 'resources', 'assets', 'thematic', 'animations', 'armor');
    return fs.existsSync(d2) ? d2 : null;
}

function bbPath() {
    const d = armorDir(); return d && fs.existsSync(PathModule.join(d, 'ArmorAnimations.bbmodel')) ? PathModule.join(d, 'ArmorAnimations.bbmodel') : null;
}

function git(args) {
    const r = ROOT; if (!r) return { ok: false, out: '' };
    try {
        const out = child_process.execSync('git ' + args.join(' '), { cwd: r, encoding: 'utf-8', maxBuffer: 10485760, timeout: 30000 }).trim();
        return { ok: true, out, err: '' };
    } catch (e) { return { ok: false, out: (e.stdout || '').trim(), err: (e.stderr || e.message || '').trim() }; }
}

function gitFiles() {
    const r = git(['status', '--porcelain', '-u']);
    if (!r.ok) return [];
    const rel = PathModule.relative(ROOT, armorDir());
    return r.out.split('\n').filter(l => l.trim()).map(l => ({
        path: l.substring(3).trim(), isNew: l.startsWith('??') || l.startsWith('A '),
    })).filter(f => f.path.includes(rel));
}

function currentBranch() { const r = git(['rev-parse', '--abbrev-ref', 'HEAD']); return r.ok ? r.out : 'unknown'; }

function listAnims() {
    const d = armorDir(); if (!d) return [];
    try {
        return fs.readdirSync(d).filter(f => f.endsWith('.json') && !f.endsWith('.bbmodel')).sort().map(f => ({
            path: PathModule.join(d, f), id: f.replace(/\.(animation\.)?json$/i, ''),
        }));
    } catch (e) { return []; }
}

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) { return null; } }
function writeJSON(fp, d) { try { fs.writeFileSync(fp, JSON.stringify(d, null, 4), 'utf-8'); return true; } catch (e) { return false; } }

const LEG_BOOT = {
    armorLeftLeg: 'armorLeftBoot', armorRightLeg: 'armorRightBoot',
    leftLeg: 'armorLeftBoot', rightLeg: 'armorRightBoot',
    bipedLeftLeg: 'armorLeftBoot', bipedRightLeg: 'armorRightBoot',
};

function legToBoot(data) {
    if (!data || !data.animations) return false;
    let m = false;
    for (const a of Object.values(data.animations)) {
        if (!a.bones) continue;
        for (const [leg, boot] of Object.entries(LEG_BOOT)) {
            const lb = a.bones[leg]; if (!lb) continue;
            if ((lb.rotation && Object.keys(lb.rotation).length) || (lb.position && Object.keys(lb.position).length)) {
                if (!a.bones[boot]) a.bones[boot] = {};
                if (lb.rotation && Object.keys(lb.rotation).length) { a.bones[boot].rotation = JSON.parse(JSON.stringify(lb.rotation)); m = true; }
                if (lb.position && Object.keys(lb.position).length) { a.bones[boot].position = JSON.parse(JSON.stringify(lb.position)); m = true; }
            }
        }
    }
    return m;
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
    function vec(v) {
        if (Array.isArray(v)) return { x: v[0] || 0, y: v[1] || 0, z: v[2] || 0 };
        if (v && typeof v === 'object') return { x: v.x || 0, y: v.y || 0, z: v.z || 0 };
        return { x: 0, y: 0, z: 0 };
    }
    for (const [boneName, bd] of Object.entries(bones)) {
        const uuid = findUUID(boneName);
        const kf = [];
        for (const ch of ['rotation', 'position', 'scale']) {
            const gkf = bd[ch];
            if (!gkf) continue;
            for (const [ts, kv] of Object.entries(gkf)) {
                const v = kv.vector || kv;
                kf.push({ time: parseFloat(ts), channel: ch, data_points: [vec(v)], interpolation: kv.lerp_mode || (kv.easing === 'catmullrom' ? 'catmullrom' : 'linear') });
            }
        }
        if (kf.length) animators[uuid] = { name: boneName, keyframes: kf };
    }
    return animators;
}

// ── Panel component ──────────────────────────────────────────────

const VAR_DEFS = [
    ['velocity_x', 'Vel X', -10, 10, 0], ['velocity_z', 'Vel Z', -10, 10, 0],
    ['velocity_y', 'Vel Y', -10, 10, 0], ['animation_speed', 'Speed', 0, 5, 1],
    ['animation_cutoff', 'Cutoff', 0, 1, 1], ['limb_swing', 'Limb Swing', 0, 1, 0],
    ['body_roll', 'Body Roll', -90, 90, 0], ['body_pitch', 'Body Pitch', -90, 90, 0],
];

const VAR_ROW = (k, l) => `<div class="tm-v"><label title="$${k}">${l}</label><input type="range" :min="vd.${k}.min||0" :max="vd.${k}.max||1" step="0.01" v-model="vars.${k}" @input="onVar('${k}')" /><span class="vv">{{ Number(vars.${k}).toFixed(2) }}</span></div>`;

const THEMATIC_STYLES = `
.tm{display:flex;flex-direction:column;height:100%;overflow:hidden;}
.tm-bar{display:flex;gap:4px;flex-wrap:wrap;padding:8px 8px 0 8px;flex-shrink:0;}
.tm-bar button{padding:4px 10px;border:1px solid #555;background:#333;color:#ccc;cursor:pointer;border-radius:3px;font-size:12px;}
.tm-bar button:hover{background:#444;}
.tm-bar .p{background:#1e6f9f;border-color:#1e6f9f;color:#fff;}
.tm-bar .p:hover{background:#2585c0;}
.tm-s{margin:8px 8px 0 8px;padding:4px 6px;background:#222;border:1px solid #555;color:#ccc;border-radius:3px;flex-shrink:0;}
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
`;

Blockbench.addCSS(THEMATIC_STYLES);

BARS.defineActions(function() {

    new Action('thematic-project-open', {
        icon: 'folder_open',
        name: 'Open Thematic Project',
        description: 'Open ArmorAnimations.bbmodel and import all animations from repo',
        category: TITLE,
        click() {
            const bb = bbPath();
            if (!bb) { Blockbench.showMessageBox({ title: 'Error', message: 'ArmorAnimations.bbmodel not found.', icon: 'warning' }); return; }
            if (ModelProject && typeof ModelProject.open === 'function') {
                const p = ModelProject.open(bb);
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        setTimeout(() => {
                            Blockbench.dispatchEvent('thematic_import');
                        }, 500);
                    }).catch(e => {
                        Blockbench.showMessageBox({ title: 'Error', message: 'Failed to open: ' + e.message, icon: 'error' });
                    });
                } else {
                    Blockbench.dispatchEvent('thematic_import');
                }
            } else {
                Blockbench.showMessageBox({ title: 'Open Manually', message: 'Open ArmorAnimations.bbmodel (File \u2192 Open), then use Sync.', icon: 'info' });
            }
        }
    });

    new Action('thematic-sync', {
        icon: 'sync',
        name: 'Sync Animations from Repo',
        description: 'Import all .animation.json files into the current project',
        category: TITLE,
        click() {
            if (!ModelProject || !ModelProject.animations) {
                Blockbench.showMessageBox({ title: 'Error', message: 'Open a project first.', icon: 'warning' });
                return;
            }
            const files = listAnims();
            let added = 0;
            for (const f of files) {
                const data = readJSON(f.path);
                if (!data || !data.animations) continue;
                for (const [name, ad] of Object.entries(data.animations)) {
                    if (ModelProject.animations.find(a => a.name === name)) continue;
                    try {
                        let loop = 'once';
                        if (ad.loop === true || ad.loop === 'loop') loop = 'loop';
                        else if (ad.loop === 'hold_on_last_frame') loop = 'hold';
                        const anim = new Animation({
                            name, length: ad.animation_length || 1, loop,
                            animators: convertBones(ad.bones || {}),
                        }).add();
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
            if (!ModelProject || !ModelProject.animations || !ModelProject.animations.length) {
                Blockbench.showMessageBox({ title: 'Export', message: 'No animations in project.', icon: 'warning' }); return;
            }
            const dir = armorDir();
            if (!dir) { Blockbench.showMessageBox({ title: 'Error', message: 'Repo animations directory not found.', icon: 'error' }); return; }
            let c = 0;
            for (const a of ModelProject.animations) {
                const n = a.name || a.uuid; if (!n) continue;
                const out = { format_version: '1.8.0', animations: {} };
                out.animations[n] = { animation_length: a.length || a.animation_length || 1, loop: a.loop || false, bones: a.bones || {} };
                legToBoot(out);
                writeJSON(PathModule.join(dir, n + '.animation.json'), out);
                c++;
            }
            Blockbench.showQuickMessage(`Exported ${c} animation(s)`, 3000);
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
<button @click="sync">\u21BB Sync</button>
<button @click="save">Save</button>
<button @click="newAnim">+ New</button>
</div>
<input class="tm-s" v-model="search" placeholder="Search animations..." />
<div class="tm-l">
<div v-if="!filtered.length" class="tm-e">No animations found</div>
<div v-for="it in filtered" :key="it.id" class="tm-i" :class="{sel: it.path===sel}" @click="pick(it.path)" @dblclick="openFile(it.path)">
<span class="tm-d" :class="it.gc"></span><span class="tm-n">{{ it.id }}</span><span class="tm-c">{{ it.nc }}</span>
</div>
</div>
<div class="tm-hint">Double-click to open animation file</div>

<div v-if="sel" class="tm-detail">
<div class="tm-x"><input type="checkbox" v-model="legBoot" id="clb" /><label for="clb">Auto-copy Leg \u2192 Boot</label></div>
<div class="tm-v" v-for="d in vdefs" :key="d[0]">
<label :title="'$'+d[0]">{{ d[1] }}</label>
<input type="range" :min="d[2]" :max="d[3]" step="0.01" v-model.number="vars[d[0]]" @input="onVar" />
<span class="vv">{{ Number(vars[d[0]]||d[4]).toFixed(2) }}</span>
</div>
</div>

<div class="tm-bot">
<div class="tm-sep"></div>
<div v-if="gits.length" style="padding:0 8px;">
<div v-for="f in gits" class="tm-gf"><span class="fp">{{ f.path }}</span><span class="fl" :class="f.isNew?'n':'m'">{{ f.isNew?'New':'Mod' }}</span></div>
</div>
<div v-else class="tm-e" style="padding:4px;">Clean</div>
<div class="tm-cr">
<input v-model="cmsg" @keydown.enter="onCommit" placeholder="Commit message..." />
<button class="p" @click="onCommit">Commit</button>
<button @click="onPush">Branch+PR</button>
</div>
<div class="tm-lg"><div v-for="r in recent" :key="r">{{ r }}</div></div>
<div class="tm-ft"><span>{{ status }}</span><span>{{ branch }}</span></div>
</div>
</div>`,
            data() {
                return {
                    search: '', sel: null, legBoot: true, cmsg: '',
                    status: 'Ready', branch: '', items: [], gits: [],
                    recent: [], vars: {}, vdefs: VAR_DEFS,
                };
            },
            computed: {
                filtered() {
                    if (!this.search) return this.items;
                    const q = this.search.toLowerCase();
                    return this.items.filter(i => i.id.includes(q));
                },
            },
            methods: {
                refresh() {
                    this.branch = currentBranch();
                    const anims = listAnims();
                    const gfs = gitFiles();
                    this.gits = gfs;
                    this.items = anims.map(a => {
                        const gf = gfs.find(g => g.path.includes(a.id));
                        const data = readJSON(a.path);
                        const nc = data && data.animations ? Object.keys(data.animations).length : 0;
                        return { id: a.id, path: a.path, nc, gc: gf ? (gf.isNew ? 'b' : 'y') : 'g' };
                    });
                    this.status = `${anims.length} anims, ${gfs.length} changed`;
                },
                pick(fp) {
                    this.sel = fp;
                    const d = readJSON(fp);
                    if (!d) return;
                    this.vars = Object.assign({}, d.thematic || d.thematic_variables || {});
                },
                onVar() {
                    const d = readJSON(this.sel);
                    if (d) {
                        if (!d.thematic) d.thematic = {};
                        Object.assign(d.thematic, this.vars);
                        writeJSON(this.sel, d);
                    }
                },
                openProject() {
                    const bb = bbPath();
                    if (!bb) { Blockbench.showMessageBox({ title: 'Error', message: 'ArmorAnimations.bbmodel not found.', icon: 'warning' }); return; }
                    if (ModelProject && typeof ModelProject.open === 'function') {
                        ModelProject.open(bb).then(() => {
                            setTimeout(() => this.sync(), 500);
                        }).catch(e => {
                            Blockbench.showMessageBox({ title: 'Error', message: 'Failed to open: ' + e.message, icon: 'error' });
                        });
                    } else {
                        Blockbench.showMessageBox({ title: 'Error', message: 'Cannot access project API.', icon: 'error' });
                    }
                },
                sync() {
                    if (!ModelProject || !ModelProject.animations) {
                        Blockbench.showMessageBox({ title: 'Error', message: 'Open a project first.', icon: 'warning' }); return;
                    }
                    const files = listAnims();
                    let added = 0;
                    for (const f of files) {
                        const data = readJSON(f.path);
                        if (!data || !data.animations) continue;
                        for (const [name, ad] of Object.entries(data.animations)) {
                            if (ModelProject.animations.find(a => a.name === name)) continue;
                            try {
                                let loop = 'once';
                                if (ad.loop === true || ad.loop === 'loop') loop = 'loop';
                                else if (ad.loop === 'hold_on_last_frame') loop = 'hold';
                                new Animation({
                                    name, length: ad.animation_length || 1, loop,
                                    animators: convertBones(ad.bones || {}),
                                }).add().select();
                                added++;
                            } catch (e) { console.error(e); }
                        }
                    }
                    if (added && Timeline && Timeline.update) Timeline.update();
                    if (added) Blockbench.showQuickMessage(`Imported ${added} animation(s)`, 3000);
                    this.refresh();
                },
                save() {
                    const dir = armorDir();
                    if (!dir) { Blockbench.showMessageBox({ title: 'Error', message: 'Not found.', icon: 'error' }); return; }
                    if (!ModelProject || !ModelProject.animations) { Blockbench.showMessageBox({ title: 'Error', message: 'No animations.', icon: 'warning' }); return; }
                    let c = 0;
                    for (const a of ModelProject.animations) {
                        const n = a.name || a.uuid; if (!n) continue;
                        const out = { format_version: '1.8.0', animations: {} };
                        out.animations[n] = { animation_length: a.length || a.animation_length || 1, loop: a.loop || false, bones: a.bones || {} };
                        legToBoot(out);
                        writeJSON(PathModule.join(dir, n + '.animation.json'), out);
                        c++;
                    }
                    Blockbench.showQuickMessage(`Exported ${c} animation(s)`, 3000);
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
                openFile(fp) {
                    if (shell && shell.openPath) {
                        shell.openPath(fp);
                    } else {
                        child_process.execSync(`open "${fp}"`);
                    }
                },
                onCommit() {
                    const msg = this.cmsg.trim();
                    if (!msg) { Blockbench.showMessageBox({ title: 'Error', message: 'Enter a message.', icon: 'warning' }); return; }
                    git(['add', '--', PathModule.relative(ROOT, armorDir())]);
                    const c = git(['commit', '-m', msg]);
                    if (c.ok || c.out.includes('nothing to commit')) { this.cmsg = ''; this.refresh(); Blockbench.showQuickMessage('Committed', 3000); }
                    else { Blockbench.showMessageBox({ title: 'Error', message: c.err, icon: 'error' }); }
                },
                onPush() {
                    const base = currentBranch();
                    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                    const bn = base + '-anim/' + ts;
                    this.status = 'Branching...';
                    const msg = this.cmsg.trim() || 'Animation update ' + ts;
                    const rel = PathModule.relative(ROOT, armorDir());
                    git(['add', '--', rel]);
                    git(['commit', '-m', msg]);
                    git(['checkout', '-b', bn]);
                    const pu = git(['push', '--set-upstream', 'origin', bn]);
                    if (!pu.ok) { git(['checkout', base]); Blockbench.showMessageBox({ title: 'Error', message: pu.err, icon: 'error' }); return; }
                    let prUrl = '';
                    try {
                        prUrl = child_process.execSync(`gh pr create --base "${base}" --head "${bn}" --title "${msg}" --body "Animation update by ${TITLE}"`, { cwd: ROOT, encoding: 'utf-8', timeout: 15000 }).trim();
                    } catch (e) {}
                    git(['checkout', base]);
                    this.cmsg = '';
                    this.refresh();
                    this.recent.unshift('Pushed: ' + bn);
                    this.status = 'Pushed to ' + bn;
                    const link = prUrl || (`https://github.com/awitkowski0/Thematic/pull/new/${bn}`);
                    Blockbench.showMessageBox({ title: 'Done', message: `Pushed to ${bn}\n\n${prUrl ? 'PR: ' + prUrl : 'Create PR: ' + link}`, icon: 'info' });
                },
            },
            mounted() {
                this.refresh();
                setInterval(() => this.refresh(), 8000);
            },
        },
    });
});
