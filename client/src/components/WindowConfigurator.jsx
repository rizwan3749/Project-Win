import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

function clearAndDisposeGroup(group) {
  const children = [...group.children]
  for (const child of children) {
    child.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose()
        const mats = obj.material
        if (Array.isArray(mats)) mats.forEach((m) => m.dispose())
        else mats?.dispose()
      }
    })
    group.remove(child)
  }
}

function syncWeights(prev, newLen) {
  const n = Math.max(1, Math.round(newLen))
  if (prev.length === n) return [...prev]
  if (n < prev.length) return prev.slice(0, n)
  const fill = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 1
  return [...prev, ...Array(n - prev.length).fill(fill)]
}

function computeAxisLayout(weights, innerSize, count, mullionW) {
  const w = syncWeights(weights, count)
  const gaps = Math.max(0, count - 1)
  const usable = innerSize - gaps * mullionW
  const sum = w.reduce((a, b) => a + b, 0) || 1
  const spans = w.map((x) => (usable * x) / sum)
  const starts = []
  const centers = []
  let acc = -innerSize / 2
  for (let i = 0; i < count; i++) {
    starts.push(acc)
    const span = spans[i]
    centers.push(acc + span / 2)
    acc += span
    if (i < count - 1) acc += mullionW
  }
  return { spans, starts, centers, weights: w }
}

function buildWindowModel(config, envMapIntensity = 0.55) {
  const {
    width: W,
    height: H,
    cols,
    rows,
    frameWidth: fw,
    frameDepth: fd,
    mullionWidth: mw,
    frameColor,
    glassColor,
    glassTransmission,
    paneOpenings,
    colWeights,
    rowWeights,
    frameCornerRadius,
    glassCornerRadius,
  } = config

  const c = Math.max(1, Math.min(12, Math.round(cols)))
  const r = Math.max(1, Math.min(12, Math.round(rows)))

  const group = new THREE.Group()
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(frameColor),
    roughness: 0.42,
    metalness: 0.06,
    envMapIntensity,
  })

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(glassColor),
    metalness: 0,
    roughness: 0.08,
    transmission: glassTransmission,
    thickness: 0.025,
    ior: 1.5,
    transparent: true,
    opacity: 0.96,
    envMapIntensity: 1,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
  })

  const rFrame = Math.min(frameCornerRadius, fw * 0.45, fd * 0.45, W * 0.04, H * 0.04)
  const segs = 2

  const addFrameBox = (sx, sy, sz, px, py, pz) => {
    const rad = Math.min(rFrame, sx / 2, sy / 2, sz / 2)
    const g = new RoundedBoxGeometry(sx, sy, sz, segs, rad)
    const m = new THREE.Mesh(g, frameMat.clone())
    m.position.set(px, py, pz)
    group.add(m)
  }

  addFrameBox(W, fw, fd, 0, H / 2 - fw / 2, 0)
  addFrameBox(W, fw, fd, 0, -H / 2 + fw / 2, 0)
  addFrameBox(fw, H - 2 * fw, fd, -W / 2 + fw / 2, 0, 0)
  addFrameBox(fw, H - 2 * fw, fd, W / 2 - fw / 2, 0, 0)

  const innerW = W - 2 * fw
  const innerH = H - 2 * fw

  const colLayout = computeAxisLayout(colWeights, innerW, c, mw)
  const rowLayout = computeAxisLayout(rowWeights, innerH, r, mw)

  for (let k = 0; k < c - 1; k++) {
    const x = colLayout.starts[k] + colLayout.spans[k] + mw / 2
    addFrameBox(mw, innerH, fd, x, 0, 0)
  }
  for (let k = 0; k < r - 1; k++) {
    const y = rowLayout.starts[k] + rowLayout.spans[k] + mw / 2
    addFrameBox(innerW, mw, fd, 0, y, 0)
  }

  const glassZ = fd / 2 - 0.012
  const glassT = 0.018
  const inset = 0.006

  for (let i = 0; i < c; i++) {
    for (let j = 0; j < r; j++) {
      const cx = colLayout.centers[i]
      const cy = rowLayout.centers[j]
      const gw = Math.max(0.03, colLayout.spans[i] - inset * 2)
      const gh = Math.max(0.03, rowLayout.spans[j] - inset * 2)
      const rGlass = Math.min(glassCornerRadius, gw * 0.35, gh * 0.35, glassT * 2)
      const gg = new RoundedBoxGeometry(gw, gh, glassT, segs, rGlass)
      const gm = new THREE.Mesh(gg, glassMat.clone())

      const uiRow = r - 1 - j
      const openDeg = paneOpenings?.[`${i}-${uiRow}`] ?? 0
      const isOpen = openDeg > 0.5
      if (isOpen) {
        const hinge = new THREE.Group()
        const left = cx - gw / 2
        hinge.position.set(left, cy, glassZ)
        hinge.rotation.y = THREE.MathUtils.degToRad(-openDeg)
        gm.position.set(gw / 2, 0, 0)
        hinge.add(gm)
        group.add(hinge)
      } else {
        gm.position.set(cx, cy, glassZ)
        group.add(gm)
      }
    }
  }

  const sillR = Math.min(rFrame * 0.8, fw * 0.35)
  const sill = new THREE.Mesh(
    new RoundedBoxGeometry(W + 0.06, fw * 0.85, fd + 0.04, segs, sillR),
    frameMat.clone(),
  )
  sill.position.set(0, -H / 2 - fw * 0.45, -0.01)
  group.add(sill)

  return group
}

const MIN_PANE = 0.06
const MAX_CUTS = 11

function normalizeCuts(raw) {
  const sorted = [...raw].map((v) => THREE.MathUtils.clamp(v, MIN_PANE, 1 - MIN_PANE)).sort((a, b) => a - b)
  const out = []
  for (const x of sorted) {
    if (out.length && x - out[out.length - 1] < MIN_PANE) continue
    out.push(x)
  }
  return out.slice(0, MAX_CUTS)
}

function cutsToWeights(cuts) {
  const edges = [0, ...normalizeCuts(cuts), 1]
  const weights = []
  for (let i = 0; i < edges.length - 1; i++) weights.push(edges[i + 1] - edges[i])
  return { weights, count: weights.length }
}

function distributeEven1D(count) {
  if (count <= 1) return []
  return Array.from({ length: count - 1 }, (_, i) => (i + 1) / count)
}

function formatDimLen(meters, unit) {
  if (unit === 'mm') return `${(meters * 1000).toFixed(1)} mm`
  if (unit === 'in') return `${(meters * 39.3700787).toFixed(2)} in`
  return `${meters.toFixed(3)} m`
}

function computeCellMetrics(cfg) {
  const W = cfg.width
  const H = cfg.height
  const fw = cfg.frameWidth
  const mw = cfg.mullionWidth
  const innerW = W - 2 * fw
  const innerH = H - 2 * fw
  const c = cfg.cols
  const r = cfg.rows
  const colLayout = computeAxisLayout(cfg.colWeights, innerW, c, mw)
  const rowLayout = computeAxisLayout(cfg.rowWeights, innerH, r, mw)
  const cells = []
  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) {
      cells.push({
        i,
        j,
        wM: colLayout.spans[i],
        hM: rowLayout.spans[j],
      })
    }
  }
  return { cells, outerW: W, outerH: H }
}

function buildOrbitExportHtml(config) {
  const safeConfig = JSON.stringify(config).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Window Orbit Preview</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #d6dde7; }
      #app { width: 100%; height: 100%; }
      .tag {
        position: fixed; top: 10px; left: 10px; padding: 6px 8px;
        font: 12px/1.2 Arial, sans-serif; color: #fff; background: rgba(0,0,0,0.45);
        border-radius: 6px; user-select: none; pointer-events: none;
      }
      .controls {
        position: fixed; top: 10px; right: 10px; display: flex; gap: 8px; align-items: center;
        padding: 6px 8px; border-radius: 8px; background: rgba(0,0,0,0.45); color: #fff;
        font: 12px/1.2 Arial, sans-serif;
      }
      .controls button, .controls select {
        border: 1px solid rgba(255,255,255,0.25); background: rgba(20,20,20,0.65); color: #fff;
        border-radius: 6px; padding: 4px 8px; font: inherit;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div class="tag">Orbit window preview</div>
    <div class="controls">
      <button id="toggleSizes" type="button">Show Sizes</button>
      <select id="unitSelect">
        <option value="mm">mm</option>
        <option value="m">m</option>
        <option value="in">inch</option>
      </select>
    </div>
    <script type="module">
      import * as THREE from 'https://esm.sh/three@0.184.0';
      import { OrbitControls } from 'https://esm.sh/three@0.184.0/examples/jsm/controls/OrbitControls.js';
      import { RoomEnvironment } from 'https://esm.sh/three@0.184.0/examples/jsm/environments/RoomEnvironment.js';
      import { RoundedBoxGeometry } from 'https://esm.sh/three@0.184.0/examples/jsm/geometries/RoundedBoxGeometry.js';

      const config = ${safeConfig};

      function computeAxisLayout(weights, innerSize, count, mullionW) {
        const gaps = Math.max(0, count - 1);
        const usable = innerSize - gaps * mullionW;
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        const spans = weights.map((x) => (usable * x) / sum);
        const starts = [];
        const centers = [];
        let acc = -innerSize / 2;
        for (let i = 0; i < count; i++) {
          starts.push(acc);
          centers.push(acc + spans[i] / 2);
          acc += spans[i];
          if (i < count - 1) acc += mullionW;
        }
        return { spans, starts, centers };
      }

      function buildWindowModel(cfg, envMapIntensity = 0.55) {
        const {
          width: W, height: H, cols, rows, frameWidth: fw, frameDepth: fd, mullionWidth: mw,
          frameColor, glassColor, glassTransmission, paneOpenings, colWeights, rowWeights,
          frameCornerRadius, glassCornerRadius
        } = cfg;
        const group = new THREE.Group();
        const frameMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(frameColor), roughness: 0.42, metalness: 0.06, envMapIntensity
        });
        const glassMat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(glassColor), metalness: 0, roughness: 0.08, transmission: glassTransmission,
          thickness: 0.025, ior: 1.5, transparent: true, opacity: 0.96, envMapIntensity: 1,
          clearcoat: 0.35, clearcoatRoughness: 0.12
        });
        const segs = 2;
        const rFrame = Math.min(frameCornerRadius, fw * 0.45, fd * 0.45, W * 0.04, H * 0.04);
        const addFrameBox = (sx, sy, sz, px, py, pz) => {
          const rad = Math.min(rFrame, sx / 2, sy / 2, sz / 2);
          const g = new RoundedBoxGeometry(sx, sy, sz, segs, rad);
          const m = new THREE.Mesh(g, frameMat.clone());
          m.position.set(px, py, pz);
          group.add(m);
        };
        addFrameBox(W, fw, fd, 0, H / 2 - fw / 2, 0);
        addFrameBox(W, fw, fd, 0, -H / 2 + fw / 2, 0);
        addFrameBox(fw, H - 2 * fw, fd, -W / 2 + fw / 2, 0, 0);
        addFrameBox(fw, H - 2 * fw, fd, W / 2 - fw / 2, 0, 0);

        const innerW = W - 2 * fw;
        const innerH = H - 2 * fw;
        const col = computeAxisLayout(colWeights, innerW, cols, mw);
        const row = computeAxisLayout(rowWeights, innerH, rows, mw);

        for (let k = 0; k < cols - 1; k++) addFrameBox(mw, innerH, fd, col.starts[k] + col.spans[k] + mw / 2, 0, 0);
        for (let k = 0; k < rows - 1; k++) addFrameBox(innerW, mw, fd, 0, row.starts[k] + row.spans[k] + mw / 2, 0);

        const glassZ = fd / 2 - 0.012;
        const glassT = 0.018;
        const inset = 0.006;
        const cells = [];
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const cx = col.centers[i];
            const cy = row.centers[j];
            const gw = Math.max(0.03, col.spans[i] - inset * 2);
            const gh = Math.max(0.03, row.spans[j] - inset * 2);
            const rGlass = Math.min(glassCornerRadius, gw * 0.35, gh * 0.35, glassT * 2);
            const gg = new RoundedBoxGeometry(gw, gh, glassT, segs, rGlass);
            const gm = new THREE.Mesh(gg, glassMat.clone());
            const uiRow = rows - 1 - j;
            const openDeg = paneOpenings && paneOpenings[i + '-' + uiRow] ? paneOpenings[i + '-' + uiRow] : 0;
            if (openDeg > 0.5) {
              const hinge = new THREE.Group();
              const left = cx - gw / 2;
              hinge.position.set(left, cy, glassZ);
              hinge.rotation.y = THREE.MathUtils.degToRad(-openDeg);
              gm.position.set(gw / 2, 0, 0);
              hinge.add(gm);
              group.add(hinge);
            } else {
              gm.position.set(cx, cy, glassZ);
              group.add(gm);
            }
            cells.push({ i, j, cx, cy, wM: col.spans[i], hM: row.spans[j] });
          }
        }

        const sillR = Math.min(rFrame * 0.8, fw * 0.35);
        const sill = new THREE.Mesh(
          new RoundedBoxGeometry(W + 0.06, fw * 0.85, fd + 0.04, segs, sillR),
          frameMat.clone()
        );
        sill.position.set(0, -H / 2 - fw * 0.45, -0.01);
        group.add(sill);
        return { group, cells };
      }

      function formatDimLen(meters, unit) {
        if (unit === 'mm') return (meters * 1000).toFixed(1) + ' mm';
        if (unit === 'in') return (meters * 39.3700787).toFixed(2) + ' in';
        return meters.toFixed(3) + ' m';
      }

      function createTextSprite(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 10;
        ctx.font = 'bold 34px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(0.92, 0.19, 1);
        return sprite;
      }

      function addDimLine(group, start, end, color, z) {
        const points = [
          new THREE.Vector3(start.x, start.y, z),
          new THREE.Vector3(end.x, end.y, z)
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
        const line = new THREE.Line(geo, mat);
        group.add(line);
      }

      function addArrowTicks(group, pos, dir, size, color, z) {
        const n = dir.clone().normalize();
        const p = new THREE.Vector3(-n.y, n.x, 0);
        const a = new THREE.Vector3(pos.x, pos.y, z);
        const b = a.clone().add(n.clone().multiplyScalar(size)).add(p.clone().multiplyScalar(size * 0.5));
        const c = a.clone().add(n.clone().multiplyScalar(size)).add(p.clone().multiplyScalar(-size * 0.5));
        addDimLine(group, a, b, color, z);
        addDimLine(group, a, c, color, z);
      }

      const host = document.getElementById('app');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xe8ecf2);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
      camera.position.set(2.4, 1.1, 3.6);
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      host.appendChild(renderer.domElement);

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.35);
      key.position.set(4, 8, 6);
      key.castShadow = true;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xd4e6ff, 0.45);
      fill.position.set(-5, 2, -4);
      scene.add(fill);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshStandardMaterial({ color: 0xd0d4db, roughness: 0.92, metalness: 0 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.65;
      floor.receiveShadow = true;
      scene.add(floor);

      const built = buildWindowModel(config, 0.55);
      const windowModel = built.group;
      const cells = built.cells;
      windowModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(windowModel);
      const measureGroup = new THREE.Group();
      scene.add(measureGroup);
      let showSizes = false;
      let currentUnit = 'mm';

      function refreshLabels() {
        while (measureGroup.children.length) {
          const child = measureGroup.children[0];
          measureGroup.remove(child);
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
        if (!showSizes) return;
        const z = config.frameDepth / 2 + 0.2;
        const color = 0xffffff;
        const arrow = 0.035;

        for (const cell of cells) {
          const x1 = cell.cx - cell.wM / 2 + 0.01;
          const x2 = cell.cx + cell.wM / 2 - 0.01;
          const y1 = cell.cy - cell.hM / 2 + 0.01;
          const y2 = cell.cy + cell.hM / 2 - 0.01;

          const yDim = y2 + 0.03;
          addDimLine(measureGroup, { x: x1, y: yDim }, { x: x2, y: yDim }, color, z);
          addArrowTicks(measureGroup, { x: x1, y: yDim }, new THREE.Vector2(1, 0), arrow, color, z);
          addArrowTicks(measureGroup, { x: x2, y: yDim }, new THREE.Vector2(-1, 0), arrow, color, z);
          const wt = createTextSprite(formatDimLen(cell.wM, currentUnit));
          wt.position.set((x1 + x2) / 2, yDim + 0.045, z);
          measureGroup.add(wt);

          const xDim = x2 + 0.03;
          addDimLine(measureGroup, { x: xDim, y: y1 }, { x: xDim, y: y2 }, color, z);
          addArrowTicks(measureGroup, { x: xDim, y: y1 }, new THREE.Vector2(0, 1), arrow, color, z);
          addArrowTicks(measureGroup, { x: xDim, y: y2 }, new THREE.Vector2(0, -1), arrow, color, z);
          const ht = createTextSprite(formatDimLen(cell.hM, currentUnit));
          ht.position.set(xDim + 0.055, (y1 + y2) / 2, z);
          ht.material.rotation = Math.PI / 2;
          measureGroup.add(ht);
        }

        const ow = config.width;
        const oh = config.height;
        const ox1 = -ow / 2;
        const ox2 = ow / 2;
        const oy1 = -oh / 2;
        const oy2 = oh / 2;

        const oyDim = oy1 - 0.12;
        addDimLine(measureGroup, { x: ox1, y: oyDim }, { x: ox2, y: oyDim }, color, z);
        addArrowTicks(measureGroup, { x: ox1, y: oyDim }, new THREE.Vector2(1, 0), arrow * 1.15, color, z);
        addArrowTicks(measureGroup, { x: ox2, y: oyDim }, new THREE.Vector2(-1, 0), arrow * 1.15, color, z);
        const owt = createTextSprite('W ' + formatDimLen(ow, currentUnit));
        owt.position.set(0, oyDim - 0.05, z);
        measureGroup.add(owt);

        const oxDim = ox1 - 0.12;
        addDimLine(measureGroup, { x: oxDim, y: oy1 }, { x: oxDim, y: oy2 }, color, z);
        addArrowTicks(measureGroup, { x: oxDim, y: oy1 }, new THREE.Vector2(0, 1), arrow * 1.15, color, z);
        addArrowTicks(measureGroup, { x: oxDim, y: oy2 }, new THREE.Vector2(0, -1), arrow * 1.15, color, z);
        const oht = createTextSprite('H ' + formatDimLen(oh, currentUnit));
        oht.position.set(oxDim - 0.055, 0, z);
        oht.material.rotation = Math.PI / 2;
        measureGroup.add(oht);
      }

      const toggleBtn = document.getElementById('toggleSizes');
      const unitSelect = document.getElementById('unitSelect');
      toggleBtn.addEventListener('click', () => {
        showSizes = !showSizes;
        toggleBtn.textContent = showSizes ? 'Hide Sizes' : 'Show Sizes';
        refreshLabels();
      });
      unitSelect.addEventListener('change', (e) => {
        currentUnit = e.target.value;
        refreshLabels();
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.target.set(0, 0.15, 0);
      controls.minDistance = 1.2;
      controls.maxDistance = 12;
      controls.minPolarAngle = 0.08;
      controls.maxPolarAngle = Math.PI - 0.08;

      function setSize() {
        const w = host.clientWidth || window.innerWidth;
        const h = host.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      setSize();
      window.addEventListener('resize', setSize);

      function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();
    </script>
  </body>
</html>`
}

const DOC_PRESETS = {
  compact: { width: 1.35, height: 1.65 },
  standard: { width: 2.1, height: 2.2 },
  wide: { width: 2.85, height: 2.1 },
  tall: { width: 1.45, height: 2.75 },
}

const FRAME_PRESET = {
  narrow: { frameWidth: 0.07, frameDepth: 0.09 },
  standard: { frameWidth: 0.09, frameDepth: 0.11 },
  wide: { frameWidth: 0.12, frameDepth: 0.14 },
}

const MULLION_PRESET = {
  thin: 0.028,
  standard: 0.038,
  thick: 0.052,
}

const GLASS_PRESET = {
  clear: { glassColor: '#e8f4ff', glassTransmission: 0.88 },
  blue: { glassColor: '#9ec8ff', glassTransmission: 0.72 },
  gray: { glassColor: '#c5ccd4', glassTransmission: 0.55 },
}

const CORNER_PRESET = {
  square: { frameCornerRadius: 0.004, glassCornerRadius: 0.006 },
  soft: { frameCornerRadius: 0.016, glassCornerRadius: 0.02 },
  round: { frameCornerRadius: 0.028, glassCornerRadius: 0.034 },
}

const FRAME_SWATCHES = [
  { id: 'white', label: 'White', hex: '#f4f6f8' },
  { id: 'gray', label: 'Gray', hex: '#6b7280' },
  { id: 'anthracite', label: 'Anthracite', hex: '#2d333b' },
  { id: 'oak', label: 'Oak', hex: '#c4a574' },
]

export function WindowConfigurator() {
  const viewportRef = useRef(null)
  const windowGroupRef = useRef(null)
  const viewModeRef = useRef('edit')
  const threeBridgeRef = useRef(null)
  const paneOptionFieldRef = useRef(null)
  const paneOpenSelectRef = useRef(null)

  const [viewMode, setViewMode] = useState('edit')
  const [layoutTool, setLayoutTool] = useState('move')
  const [verticalCuts, setVerticalCuts] = useState([0.5])
  const [horizontalCuts, setHorizontalCuts] = useState([0.5])

  const [docPreset, setDocPreset] = useState('standard')
  const [customW, setCustomW] = useState('2.1')
  const [customH, setCustomH] = useState('2.2')
  const [framePreset, setFramePreset] = useState('standard')
  const [mullionPreset, setMullionPreset] = useState('standard')
  const [glassPreset, setGlassPreset] = useState('blue')
  const [cornerPreset, setCornerPreset] = useState('soft')
  const [frameSwatch, setFrameSwatch] = useState('white')
  const [paneOpenings, setPaneOpenings] = useState({})
  const [selectedCell, setSelectedCell] = useState(null)
  const [openDegreeInput, setOpenDegreeInput] = useState('40')
  const [dimUnit, setDimUnit] = useState('mm')
  const [showDimLabels, setShowDimLabels] = useState(false)

  const derivedConfig = useMemo(() => {
    const col = cutsToWeights(verticalCuts)
    const row = cutsToWeights(horizontalCuts)
    const fp = FRAME_PRESET[framePreset] ?? FRAME_PRESET.standard
    const gp = GLASS_PRESET[glassPreset] ?? GLASS_PRESET.blue
    const cp = CORNER_PRESET[cornerPreset] ?? CORNER_PRESET.soft
    const sw = FRAME_SWATCHES.find((s) => s.id === frameSwatch)?.hex ?? '#f4f6f8'

    const width = Math.min(3.4, Math.max(0.7, Number(customW) || 2.1))
    const height = Math.min(3.2, Math.max(0.6, Number(customH) || 2.2))

    const pruned = {}
    for (const [k, v] of Object.entries(paneOpenings)) {
      const [ci, cj] = k.split('-').map(Number)
      if (ci < col.count && cj < row.count && Number(v) > 0) pruned[k] = Number(v)
    }

    return {
      width,
      height,
      cols: col.count,
      rows: row.count,
      colWeights: col.weights,
      rowWeights: row.weights,
      frameWidth: fp.frameWidth,
      frameDepth: fp.frameDepth,
      mullionWidth: MULLION_PRESET[mullionPreset] ?? MULLION_PRESET.standard,
      frameColor: sw,
      glassColor: gp.glassColor,
      glassTransmission: gp.glassTransmission,
      paneOpenings: pruned,
      frameCornerRadius: cp.frameCornerRadius,
      glassCornerRadius: cp.glassCornerRadius,
    }
  }, [
    verticalCuts,
    horizontalCuts,
    customW,
    customH,
    framePreset,
    mullionPreset,
    glassPreset,
    cornerPreset,
    frameSwatch,
    paneOpenings,
  ])

  const cellMetrics = useMemo(() => computeCellMetrics(derivedConfig), [derivedConfig])

  useEffect(() => {
    const container = viewportRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe8ecf2)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80)
    camera.position.set(2.4, 1.1, 3.6)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9099, 0.55)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xffffff, 1.35)
    key.position.set(4, 8, 6)
    key.castShadow = true
    key.shadow.mapSize.setScalar(2048)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 40
    key.shadow.camera.left = -8
    key.shadow.camera.right = 8
    key.shadow.camera.top = 8
    key.shadow.camera.bottom = -8
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xd4e6ff, 0.45)
    fill.position.set(-5, 2, -4)
    scene.add(fill)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0xd0d4db, roughness: 0.92, metalness: 0 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.65
    floor.receiveShadow = true
    scene.add(floor)

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 14),
      new THREE.MeshStandardMaterial({ color: 0xc5cad3, roughness: 0.98, metalness: 0 }),
    )
    back.position.set(0, 1.2, -6)
    back.receiveShadow = true
    scene.add(back)

    const windowGroup = new THREE.Group()
    windowGroupRef.current = windowGroup
    scene.add(windowGroup)

    const mouse = { x: 0, y: 0 }
    const pointerDown = { v: false }
    const onPointerMove = (event) => {
      const rect = container.getBoundingClientRect()
      const w = rect.width || 1
      const h = rect.height || 1
      mouse.x = ((event.clientX - rect.left) / w) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / h) * 2 + 1
    }
    container.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', () => {
      pointerDown.v = true
    })
    renderer.domElement.addEventListener('pointerup', () => {
      pointerDown.v = false
    })
    renderer.domElement.addEventListener('pointerleave', () => {
      pointerDown.v = false
    })

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.target.set(0, 0.15, 0)
    controls.minDistance = 1.2
    controls.maxDistance = 12
    controls.minPolarAngle = 0.08
    controls.maxPolarAngle = Math.PI - 0.08
    controls.enabled = false
    controls.update()

    threeBridgeRef.current = { camera, controls, renderer }

    const setSize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    setSize()
    const ro = new ResizeObserver(setSize)
    ro.observe(container)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const g = windowGroupRef.current
      if (g && viewModeRef.current === 'preview') {
        if (pointerDown.v) {
          g.rotation.x *= 0.92
          g.rotation.y *= 0.92
        } else {
          const tx = mouse.x * 0.18
          const ty = mouse.y * 0.12
          g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, ty, 0.07)
          g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, tx, 0.07)
        }
      }
      controls.update()
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      container.removeEventListener('pointermove', onPointerMove)
      ro.disconnect()
      controls.dispose()
      clearAndDisposeGroup(windowGroup)
      pmremGenerator.dispose()
      scene.environment?.dispose()
      floor.geometry.dispose()
      floor.material.dispose()
      back.geometry.dispose()
      back.material.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
      windowGroupRef.current = null
      threeBridgeRef.current = null
    }
  }, [])

  viewModeRef.current = viewMode

  useEffect(() => {
    const b = threeBridgeRef.current
    if (!b) return
    b.controls.enabled = viewMode === 'preview'
    const g = windowGroupRef.current
    if (g) g.rotation.set(0, 0, 0)
    if (viewMode === 'edit') {
      b.camera.position.set(0, 0.18, 4.95)
      b.controls.target.set(0, 0.12, 0)
      b.controls.update()
    }
  }, [viewMode])

  useEffect(() => {
    const windowGroup = windowGroupRef.current
    if (!windowGroup) return
    clearAndDisposeGroup(windowGroup)
    const model = buildWindowModel(derivedConfig, 0.55)
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    windowGroup.add(model)
  }, [derivedConfig])

  useEffect(() => {
    setSelectedCell((s) => {
      if (!s) return s
      if (s.i < derivedConfig.cols && s.j < derivedConfig.rows) return s
      return null
    })
  }, [derivedConfig.cols, derivedConfig.rows])

  useEffect(() => {
    const c = derivedConfig.cols
    const r = derivedConfig.rows
    setPaneOpenings((prev) => {
      const n = {}
      for (const [k, v] of Object.entries(prev)) {
        const [i, j] = k.split('-').map(Number)
        if (i < c && j < r) n[k] = v
      }
      return n
    })
  }, [derivedConfig.cols, derivedConfig.rows])

  const setCutsEvenV = useCallback(() => {
    const n = verticalCuts.length + 1
    setVerticalCuts(distributeEven1D(n))
  }, [verticalCuts.length])

  const setCutsEvenH = useCallback(() => {
    const n = horizontalCuts.length + 1
    setHorizontalCuts(distributeEven1D(n))
  }, [horizontalCuts.length])

  const clearCuts = useCallback(() => {
    setVerticalCuts([])
    setHorizontalCuts([])
  }, [])

  const focusPaneOptions = useCallback(() => {
    paneOptionFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      paneOpenSelectRef.current?.focus()
    }, 140)
  }, [])

  const toggleCellOpenOnDoubleClick = useCallback(
    (cell) => {
      const key = `${cell.i}-${cell.j}`
      const deg = Math.min(89, Math.max(1, Number(openDegreeInput) || 40))
      setSelectedCell(cell)
      setPaneOpenings((prev) => {
        const next = { ...prev }
        if ((next[key] ?? 0) > 0.5) delete next[key]
        else next[key] = deg
        return next
      })
      focusPaneOptions()
    },
    [openDegreeInput, focusPaneOptions],
  )

  const downloadOrbitFile = useCallback(() => {
    const html = buildOrbitExportHtml(derivedConfig)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'window-orbit-preview.html'
    a.click()
    URL.revokeObjectURL(url)
  }, [derivedConfig])

  return (
    <div className="flex h-screen min-h-0 w-full flex-col bg-[#1e1e1e] text-[#e6e6e6] md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-black border-b-[#111] bg-[#2b2b2b] shadow-xl md:w-[300px] md:border-b-0 md:border-r md:border-r-[#111]">
        <div className="border-b border-[#1a1a1a] px-3 py-2">
          <h1 className="text-[13px] font-semibold tracking-wide text-[#f3f3f3]">Window</h1>
          <p className="mt-1 text-[10px] leading-snug text-[#b0b0b0]">
            Front layout + live 3D (static). <span className="text-[#6fc3ff]">Preview</span> = orbit / move 360°.
          </p>
        </div>

        <div className="custom-scroll flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <PsField label="Outer size (type — meters)">
            <div className="flex gap-2">
              <PsNum
                label="Width"
                value={customW}
                onChange={(v) => {
                  setCustomW(v)
                  setDocPreset('custom')
                }}
              />
              <PsNum
                label="Height"
                value={customH}
                onChange={(v) => {
                  setCustomH(v)
                  setDocPreset('custom')
                }}
              />
            </div>
            <p className="mt-1 text-[9px] text-[#777]">Typing switches to custom size (free).</p>
          </PsField>

          <PsField label="Quick preset">
            <PsSelect
              value={docPreset}
              onChange={(v) => {
                setDocPreset(v)
                if (v !== 'custom' && DOC_PRESETS[v]) {
                  setCustomW(String(DOC_PRESETS[v].width))
                  setCustomH(String(DOC_PRESETS[v].height))
                }
              }}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'standard', label: 'Standard' },
                { value: 'wide', label: 'Wide' },
                { value: 'tall', label: 'Tall' },
                { value: 'custom', label: 'Custom (uses fields above)' },
              ]}
            />
          </PsField>

          <PsField label="Size labels on artboard">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDimLabels((x) => !x)}
                className={`rounded-sm px-2 py-1 text-[10px] font-medium ${
                  showDimLabels ? 'bg-[#1473e6] text-white' : 'bg-[#383838] text-[#ccc]'
                }`}
              >
                {showDimLabels ? 'Hide sizes' : 'Show sizes'}
              </button>
              <PsSelect
                value={dimUnit}
                onChange={setDimUnit}
                options={[
                  { value: 'mm', label: 'mm' },
                  { value: 'm', label: 'm' },
                  { value: 'in', label: 'inch' },
                ]}
              />
            </div>
            <p className="mt-1 text-[9px] text-[#777]">Each block shows W×H in chosen unit when Show is on.</p>
          </PsField>

          <PsField label="Frame profile">
            <PsSelect
              value={framePreset}
              onChange={setFramePreset}
              options={[
                { value: 'narrow', label: 'Narrow' },
                { value: 'standard', label: 'Standard' },
                { value: 'wide', label: 'Wide' },
              ]}
            />
          </PsField>

          <PsField label="Mullions">
            <PsSelect
              value={mullionPreset}
              onChange={setMullionPreset}
              options={[
                { value: 'thin', label: 'Thin' },
                { value: 'standard', label: 'Standard' },
                { value: 'thick', label: 'Thick' },
              ]}
            />
          </PsField>

          <PsField label="Glass">
            <PsSelect
              value={glassPreset}
              onChange={setGlassPreset}
              options={[
                { value: 'clear', label: 'Clear' },
                { value: 'blue', label: 'Tint — Cool' },
                { value: 'gray', label: 'Tint — Neutral' },
              ]}
            />
          </PsField>

          <PsField label="Corners">
            <PsSelect
              value={cornerPreset}
              onChange={setCornerPreset}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'soft', label: 'Soft' },
                { value: 'round', label: 'Round' },
              ]}
            />
          </PsField>

          <PsField label="Frame color">
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {FRAME_SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.label}
                  onClick={() => setFrameSwatch(s.id)}
                  className={`h-7 w-7 rounded border-2 shadow-inner transition ${
                    frameSwatch === s.id ? 'border-[#6fc3ff] ring-1 ring-[#6fc3ff]/50' : 'border-[#555] hover:border-[#888]'
                  }`}
                  style={{ backgroundColor: s.hex }}
                />
              ))}
            </div>
          </PsField>

          <div ref={paneOptionFieldRef}>
            <PsField label="Pane mirror / open (any block)">
            <p className="mb-1 text-[9px] text-[#888]">
              Double-click pane to open/close directly. Degree below applies to next double-click open.
            </p>
            <PsNum
              label="Quick open degree (1-89)"
              value={openDegreeInput}
              onChange={setOpenDegreeInput}
              min={1}
              max={89}
              step={1}
            />
            <div className="rounded border border-[#444] bg-[#333] px-2 py-1.5 text-[10px] text-[#bbb]">
              {selectedCell
                ? `Selected: col ${selectedCell.i + 1}, row ${selectedCell.j + 1}`
                : 'No pane selected'}
            </div>
            <PsSelect
              selectRef={paneOpenSelectRef}
              disabled={!selectedCell}
              value={(() => {
                if (!selectedCell) return '0'
                const k = `${selectedCell.i}-${selectedCell.j}`
                return String(paneOpenings[k] ?? 0)
              })()}
              onChange={(v) => {
                if (!selectedCell) return
                const k = `${selectedCell.i}-${selectedCell.j}`
                const deg = Math.min(89, Math.max(0, Number(v) || 0))
                setPaneOpenings((prev) => {
                  const n = { ...prev }
                  if (deg < 0.5) delete n[k]
                  else n[k] = deg
                  return n
                })
              }}
              options={[
                { value: '0', label: 'Closed (0°)' },
                { value: '15', label: '15°' },
                { value: '25', label: '25°' },
                { value: '40', label: '40°' },
                { value: '55', label: '55°' },
                { value: '70', label: '70°' },
              ]}
            />
            </PsField>
          </div>
        </div>

        <div className="border-t border-[#1a1a1a] p-2">
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
            className={`w-full rounded-sm py-2 text-[11px] font-semibold tracking-wide transition ${
              viewMode === 'preview'
                ? 'bg-[#3d3d3d] text-[#6fc3ff] ring-1 ring-[#6fc3ff]/40'
                : 'bg-[#1473e6] text-white hover:bg-[#0d5fbd]'
            }`}
          >
            {viewMode === 'preview' ? '← Back to layout' : 'Preview 3D →'}
          </button>
          <button
            type="button"
            onClick={downloadOrbitFile}
            className="mt-2 w-full rounded-sm border border-[#4a4a4a] bg-[#2f2f2f] py-2 text-[11px] font-semibold tracking-wide text-[#d9d9d9] transition hover:border-[#6fc3ff] hover:text-[#6fc3ff]"
          >
            Download Orbit Window
          </button>
        </div>
      </aside>

      <div className="relative flex min-h-[50vh] min-w-0 flex-1 flex-col md:min-h-0">
        <div
          className={`flex min-h-0 flex-1 flex-col bg-[#3c3c3c] md:flex-row ${viewMode === 'preview' ? 'hidden' : ''}`}
        >
          <div className="flex min-h-0 min-w-0 flex-[1.15] flex-col border-b border-[#222] md:border-b-0 md:border-r">
            <LayoutToolbar
              tool={layoutTool}
              setTool={setLayoutTool}
              onDistributeV={setCutsEvenV}
              onDistributeH={setCutsEvenH}
              onClear={clearCuts}
            />
            <WindowLayoutEditor
              widthM={derivedConfig.width}
              heightM={derivedConfig.height}
              verticalCuts={verticalCuts}
              horizontalCuts={horizontalCuts}
              setVerticalCuts={setVerticalCuts}
              setHorizontalCuts={setHorizontalCuts}
              tool={layoutTool}
              dimUnit={dimUnit}
              showDimLabels={showDimLabels}
              cellMetrics={cellMetrics}
              selectedCell={selectedCell}
              setSelectedCell={setSelectedCell}
              onCellDoubleClick={toggleCellOpenOnDoubleClick}
            />
          </div>
          <div
            className="relative min-h-[220px] min-w-0 flex-1 bg-[#2a2a2a] md:min-h-0"
            title="3D (static while editing — Preview for orbit)"
          >
            <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white">
              3D (front, no orbit)
            </div>
          </div>
        </div>

        <div
          ref={viewportRef}
          className={`bg-gradient-to-br from-[#cfd6e0] to-[#b8c2d0] [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full ${
            viewMode === 'preview'
              ? 'relative z-10 flex min-h-[50vh] flex-1 cursor-grab active:cursor-grabbing'
              : 'pointer-events-none absolute inset-y-0 right-0 z-[5] w-full max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:h-[min(40vh,340px)] max-md:w-full md:w-[min(46%,520px)]'
          }`}
        />
      </div>
    </div>
  )
}

function LayoutToolbar({ tool, setTool, onDistributeV, onDistributeH, onClear }) {
  const btn = (id, label, title) => (
    <button
      type="button"
      title={title}
      onClick={() => setTool(id)}
      className={`rounded-sm px-2 py-1.5 text-[10px] font-medium ${
        tool === id ? 'bg-[#1473e6] text-white' : 'bg-[#323232] text-[#ccc] hover:bg-[#404040]'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[#262626] bg-[#2b2b2b] px-2 py-1.5">
      {btn('move', 'Move', 'Pick and drag divider lines')}
      {btn('vertical', '│ Line', 'Click artboard to add vertical divider')}
      {btn('horizontal', '— Line', 'Click artboard to add horizontal divider')}
      <span className="mx-1 h-4 w-px bg-[#444]" />
      <button
        type="button"
        onClick={onDistributeV}
        className="rounded-sm bg-[#323232] px-2 py-1.5 text-[10px] text-[#ccc] hover:bg-[#404040]"
        title="Space vertical dividers evenly"
      >
        ║ Even
      </button>
      <button
        type="button"
        onClick={onDistributeH}
        className="rounded-sm bg-[#323232] px-2 py-1.5 text-[10px] text-[#ccc] hover:bg-[#404040]"
        title="Space horizontal dividers evenly"
      >
        ═ Even
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-sm bg-[#323232] px-2 py-1.5 text-[10px] text-[#f66] hover:bg-[#404040]"
      >
        Clear
      </button>
      <span className="ml-auto text-[9px] text-[#888]">Double-click a line to remove</span>
    </div>
  )
}

function WindowLayoutEditor({
  widthM,
  heightM,
  verticalCuts,
  horizontalCuts,
  setVerticalCuts,
  setHorizontalCuts,
  tool,
  dimUnit,
  showDimLabels,
  cellMetrics,
  selectedCell,
  setSelectedCell,
  onCellDoubleClick,
}) {
  const svgRef = useRef(null)
  const dragRef = useRef(null)

  const aspect = widthM / heightM
  const pad = 8
  const vbW = 200
  const vbH = 200
  let innerX = pad
  let innerY = pad
  let innerW = vbW - pad * 2
  let innerH = vbH - pad * 2
  if (aspect >= 1) {
    innerH = innerW / aspect
    innerY = (vbH - innerH) / 2
  } else {
    innerW = innerH * aspect
    innerX = (vbW - innerW) / 2
  }

  const toLocal = useCallback((clientX, clientY) => {
    const el = svgRef.current
    if (!el) return { x: 0, y: 0 }
    const pt = el.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = el.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = pt.matrixTransform(ctm.inverse())
    const nx = (p.x - innerX) / innerW
    const ny = (p.y - innerY) / innerH
    return { nx: THREE.MathUtils.clamp(nx, 0, 1), ny: THREE.MathUtils.clamp(ny, 0, 1) }
  }, [innerX, innerY, innerW, innerH])

  const hitLine = useCallback(
    (nx, ny) => {
      const hitPx = 4 / innerW
      const hitPy = 4 / innerH
      let best = null
      let bestScore = Infinity
      verticalCuts.forEach((t, i) => {
        const score = Math.abs(nx - t) / hitPx
        if (score < 1 && score < bestScore) {
          bestScore = score
          best = { axis: 'v', index: i, t }
        }
      })
      horizontalCuts.forEach((t, i) => {
        const score = Math.abs(ny - t) / hitPy
        if (score < 1 && score < bestScore) {
          bestScore = score
          best = { axis: 'h', index: i, t }
        }
      })
      return best
    },
    [verticalCuts, horizontalCuts, innerW, innerH],
  )

  const clampV = useCallback(
    (index, t) => {
      const prev = index === 0 ? MIN_PANE : verticalCuts[index - 1] + MIN_PANE
      const next = index === verticalCuts.length - 1 ? 1 - MIN_PANE : verticalCuts[index + 1] - MIN_PANE
      return THREE.MathUtils.clamp(t, prev, next)
    },
    [verticalCuts],
  )

  const clampH = useCallback(
    (index, t) => {
      const prev = index === 0 ? MIN_PANE : horizontalCuts[index - 1] + MIN_PANE
      const next = index === horizontalCuts.length - 1 ? 1 - MIN_PANE : horizontalCuts[index + 1] - MIN_PANE
      return THREE.MathUtils.clamp(t, prev, next)
    },
    [horizontalCuts],
  )

  const vxArr = [0, ...normalizeCuts(verticalCuts), 1]
  const hyArr = [0, ...normalizeCuts(horizontalCuts), 1]

  const hitCell = useCallback(
    (nx, ny) => {
      for (let j = 0; j < hyArr.length - 1; j++) {
        for (let i = 0; i < vxArr.length - 1; i++) {
          if (nx >= vxArr[i] && nx <= vxArr[i + 1] && ny >= hyArr[j] && ny <= hyArr[j + 1]) return { i, j }
        }
      }
      return null
    },
    [vxArr, hyArr],
  )

  const onPointerDown = (e) => {
    const { nx, ny } = toLocal(e.clientX, e.clientY)
    if (tool === 'move') {
      const hit = hitLine(nx, ny)
      if (hit) {
        dragRef.current = hit
        svgRef.current?.setPointerCapture(e.pointerId)
        return
      }
      const cell = hitCell(nx, ny)
      if (cell) setSelectedCell(cell)
      return
    }
    if (tool === 'vertical') {
      const t = THREE.MathUtils.clamp(nx, MIN_PANE, 1 - MIN_PANE)
      const next = normalizeCuts([...verticalCuts, t])
      if (next.length <= MAX_CUTS) setVerticalCuts(next)
      return
    }
    if (tool === 'horizontal') {
      const t = THREE.MathUtils.clamp(ny, MIN_PANE, 1 - MIN_PANE)
      const next = normalizeCuts([...horizontalCuts, t])
      if (next.length <= MAX_CUTS) setHorizontalCuts(next)
    }
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const { nx, ny } = toLocal(e.clientX, e.clientY)
    if (d.axis === 'v') {
      const nv = [...verticalCuts]
      nv[d.index] = clampV(d.index, nx)
      setVerticalCuts(nv)
    } else {
      const nh = [...horizontalCuts]
      nh[d.index] = clampH(d.index, ny)
      setHorizontalCuts(nh)
    }
  }

  const onPointerUp = (e) => {
    const was = dragRef.current
    dragRef.current = null
    if (was?.axis === 'v') setVerticalCuts((v) => normalizeCuts(v))
    if (was?.axis === 'h') setHorizontalCuts((h) => normalizeCuts(h))
    try {
      svgRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  const onDoubleClick = (e) => {
    const { nx, ny } = toLocal(e.clientX, e.clientY)
    const hit = hitLine(nx, ny)
    if (hit?.axis === 'v') {
      setVerticalCuts(verticalCuts.filter((_, i) => i !== hit.index))
      return
    }
    if (hit?.axis === 'h') {
      setHorizontalCuts(horizontalCuts.filter((_, i) => i !== hit.index))
      return
    }
    const cell = hitCell(nx, ny)
    if (cell) {
      setSelectedCell(cell)
      onCellDoubleClick?.(cell)
    }
  }

  const blocks = []
  const vx = vxArr
  const hy = hyArr
  for (let j = 0; j < hy.length - 1; j++) {
    for (let i = 0; i < vx.length - 1; i++) {
      const x0 = innerX + vx[i] * innerW
      const x1 = innerX + vx[i + 1] * innerW
      const y0 = innerY + hy[j] * innerH
      const y1 = innerY + hy[j + 1] * innerH
      const sel = selectedCell?.i === i && selectedCell?.j === j
      const cm = cellMetrics?.cells?.find((c) => c.i === i && c.j === j)
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      blocks.push(
        <g key={`b-${i}-${j}`}>
          <rect
            x={x0 + 0.35}
            y={y0 + 0.35}
            width={Math.max(0.5, x1 - x0 - 0.7)}
            height={Math.max(0.5, y1 - y0 - 0.7)}
            fill="rgba(255,255,255,0.06)"
            stroke={sel ? '#6fc3ff' : '#5a5a5a'}
            strokeWidth={sel ? 0.65 : 0.35}
          />
          {showDimLabels && cm && (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#f0f0f0"
              fontSize={Math.min(5.2, (x1 - x0) * 0.12)}
              style={{ pointerEvents: 'none', textShadow: '0 0 2px #000' }}
            >
              <tspan x={cx} dy="-0.15em">
                {formatDimLen(cm.wM, dimUnit)}
              </tspan>
              <tspan x={cx} dy="1.05em">
                × {formatDimLen(cm.hM, dimUnit)}
              </tspan>
            </text>
          )}
        </g>,
      )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-3">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Window layout editor"
        viewBox={`0 0 ${vbW} ${vbH}`}
        className="max-h-[min(72vh,720px)] w-full max-w-[min(96vw,900px)] cursor-crosshair touch-none rounded border border-[#1a1a1a] bg-[#262626] shadow-lg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <rect x={innerX - 1.2} y={innerY - 1.2} width={innerW + 2.4} height={innerH + 2.4} fill="#1f1f1f" stroke="#0a0a0a" strokeWidth={0.6} rx={1} />
        {showDimLabels && (
          <text
            x={innerX + innerW / 2}
            y={innerY + innerH + 5.5}
            textAnchor="middle"
            fill="#9ca3af"
            fontSize={4.2}
            style={{ pointerEvents: 'none' }}
          >
            {`Outer ${formatDimLen(widthM, dimUnit)} × ${formatDimLen(heightM, dimUnit)}`}
          </text>
        )}
        {blocks}
        {verticalCuts.map((t, i) => {
          const x = innerX + t * innerW
          return (
            <line
              key={`v-${i}`}
              x1={x}
              y1={innerY}
              x2={x}
              y2={innerY + innerH}
              stroke={tool === 'move' ? '#6fc3ff' : '#ffcc66'}
              strokeWidth={0.55}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}
        {horizontalCuts.map((t, i) => {
          const y = innerY + t * innerH
          return (
            <line
              key={`h-${i}`}
              x1={innerX}
              y1={y}
              x2={innerX + innerW}
              y2={y}
              stroke={tool === 'move' ? '#6fc3ff' : '#ffcc66'}
              strokeWidth={0.55}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}
      </svg>
    </div>
  )
}

function PsField({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9a9a9a]">{label}</div>
      {children}
    </div>
  )
}

function PsSelect({ value, onChange, options, disabled, selectRef }) {
  return (
    <select
      ref={selectRef}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full cursor-pointer rounded-sm border border-[#000] bg-[#383838] px-2 py-1.5 text-[11px] text-[#e6e6e6] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none focus:border-[#1473e6] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function PsNum({ label, value, onChange, min = 0.5, max = 4, step = 0.05 }) {
  return (
    <label className="flex flex-1 flex-col text-[9px] text-[#9a9a9a]">
      {label}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-sm border border-[#000] bg-[#383838] px-2 py-1 text-[11px] text-[#e6e6e6] outline-none focus:border-[#1473e6]"
      />
    </label>
  )
}
