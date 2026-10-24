// Minimal STL viewer on a vendored three.js bundle. Renders on demand, no animation loop.
import * as T from "./three-bundle.min.js";

const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

/** Resolve any CSS colour the browser understands (including oklch) to a three.js Color. */
export function cssColor(value, fallback = "#888888") {
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return new T.Color(`rgb(${r}, ${g}, ${b})`);
  } catch {
    return new T.Color(fallback);
  }
}

export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const VIEWS = {
  iso: [1, -1.15, 0.9],
  top: [0.0001, -0.0001, 1],
  front: [0, -1, 0.12],
  side: [1, 0, 0.12],
};

export async function createViewer(host, { meshes, edgeAngle = 24, onPick, label = "3D model" }) {
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.localClippingEnabled = false;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", `${label}. Drag to orbit, scroll to zoom, arrow keys to pan.`);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  scene.add(new T.HemisphereLight(0xffffff, 0x3a4256, 1.25));
  const key = new T.DirectionalLight(0xffffff, 2.2);
  key.position.set(60, -80, 120);
  scene.add(key);
  const fill = new T.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-90, 60, 40);
  scene.add(fill);

  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.listenToKeyEvents(renderer.domElement);

  const loader = new T.STLLoader();
  const items = new Map();
  const edgeColor = cssColor(token("--color-screen-ink"), "#eeeeee");

  await Promise.all(meshes.map(async (m) => {
    const geo = await new Promise((res, rej) => loader.load(m.url, res, undefined, rej));
    const mat = new T.MeshStandardMaterial({
      color: cssColor(token(m.color || "--accent")),
      roughness: 0.58, metalness: 0.04, flatShading: true, side: T.DoubleSide,
    });
    const mesh = new T.Mesh(geo, mat);
    const edges = new T.LineSegments(
      new T.EdgesGeometry(geo, edgeAngle),
      new T.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.38 }),
    );
    const group = new T.Group();
    group.add(mesh, edges);
    if (m.offset) group.position.set(...m.offset);
    scene.add(group);
    items.set(m.key, { key: m.key, geo, mat, mesh, edges, group, base: mat.color.clone() });
  }));

  let queued = false;
  const render = () => { queued = false; renderer.render(scene, camera); };
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
  controls.addEventListener("change", request);

  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    request();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  function bounds(onlyVisible = true) {
    const box = new T.Box3();
    items.forEach((it) => {
      if (onlyVisible && !it.group.visible) return;
      box.union(new T.Box3().setFromObject(it.group));
    });
    return box;
  }

  function frame(view = "iso") {
    const box = bounds();
    if (box.isEmpty()) return;
    const center = box.getCenter(new T.Vector3());
    const radius = box.getSize(new T.Vector3()).length() / 2;
    const dir = new T.Vector3(...VIEWS[view]).normalize();
    const dist = (radius / Math.sin(T.MathUtils.degToRad(camera.fov) / 2)) * 0.95;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(dist / 200, 0.05);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();
    request();
  }

  const clipPlane = new T.Plane(new T.Vector3(0, 0, -1), 0);
  const api = {
    renderer, items, frame, request,
    setVisible(k, v) { const it = items.get(k); if (it) { it.group.visible = v; request(); } },
    setWireframe(on) { items.forEach((it) => { it.mat.wireframe = on; it.edges.visible = !on; }); request(); },
    setClip(z) {
      if (z === null) { renderer.clippingPlanes = []; renderer.localClippingEnabled = false; }
      else { clipPlane.constant = z; renderer.clippingPlanes = [clipPlane]; renderer.localClippingEnabled = true; }
      request();
    },
    setHighlight(k) {
      items.forEach((it) => {
        const on = it.key === k;
        it.mat.emissive = on ? cssColor(token("--accent")) : new T.Color(0x000000);
        it.mat.emissiveIntensity = on ? 0.35 : 0;
      });
      request();
    },
    setOffset(k, offset) { const it = items.get(k); if (it) { it.group.position.set(...offset); request(); } },
    stats(k) {
      const it = items.get(k);
      const pos = it.geo.attributes.position;
      let vol = 0;
      const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
        vol += a.dot(b.clone().cross(c)) / 6;
      }
      it.geo.computeBoundingBox();
      const bb = it.geo.boundingBox;
      const size = bb.getSize(new T.Vector3());
      return { triangles: pos.count / 3, volume: Math.abs(vol), size: [size.x, size.y, size.z], min: bb.min.toArray(), max: bb.max.toArray() };
    },
    dispose() { ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };

  // click picking with a drag threshold so orbiting never selects
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  let down = null;
  const pick = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...items.values()].filter((i) => i.group.visible).map((i) => i.mesh), false);
    if (!hits.length) return null;
    return [...items.values()].find((i) => i.mesh === hits[0].object)?.key ?? null;
  };
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved < 5 && onPick) { const k = pick(e); if (k) onPick(k); }
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.buttons) return;
    renderer.domElement.style.cursor = onPick && pick(e) ? "pointer" : "grab";
  });

  resize();
  frame("iso");
  return api;
}
