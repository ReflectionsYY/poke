import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#120b0c', 0.02);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 6);

const controls = new PointerLockControls(camera, canvas);

const ambient = new THREE.AmbientLight('#ffe0c2', 0.3);
scene.add(ambient);

const sun = new THREE.DirectionalLight('#ffd58f', 1.5);
sun.position.set(5, 10, 2);
sun.castShadow = true;
scene.add(sun);

const floorTex = new THREE.TextureLoader().load('BGVolcano.png');
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(8, 8);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.2, roughness: 0.8 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const arenaSize = 35;
const walls = new THREE.Group();
const wallMat = new THREE.MeshStandardMaterial({ color: '#330c0c', emissive: '#e25b0a', emissiveIntensity: 0.15 });
const wallGeo = new THREE.BoxGeometry(1, 3, arenaSize * 2 + 2);

const createWall = (x, z, rot) => {
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(x, 1.5, z);
  wall.rotation.y = rot;
  wall.castShadow = wall.receiveShadow = true;
  walls.add(wall);
};

createWall(arenaSize, 0, 0);
createWall(-arenaSize, 0, 0);
createWall(0, arenaSize, Math.PI / 2);
createWall(0, -arenaSize, Math.PI / 2);
scene.add(walls);

const columns = new THREE.Group();
const columnMat = new THREE.MeshStandardMaterial({ color: '#4a1f16', emissive: '#7c2c19', roughness: 0.6 });
for (let i = 0; i < 22; i += 1) {
  const size = 1 + Math.random() * 1.2;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(size, size * 0.8, 4, 8), columnMat);
  mesh.position.set((Math.random() - 0.5) * arenaSize * 1.6, 2, (Math.random() - 0.5) * arenaSize * 1.6);
  mesh.castShadow = mesh.receiveShadow = true;
  columns.add(mesh);
}
scene.add(columns);

const pulseMaterial = new THREE.MeshStandardMaterial({ color: '#ffcf70', emissive: '#ff7b00', emissiveIntensity: 0.4 });

const targets = [];
let wave = 1;
let score = 0;
let health = 100;
let ammo = 15;
const maxAmmo = 15;
let lastShot = 0;
const moveState = { forward: false, backward: false, left: false, right: false };

const bgMusic = new Audio('BGAudio.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.4;

const fxShoot = new Audio('Pokemon%20(A%20Button)%20-%20Sound%20Effect%20(HD).mp3');
fxShoot.volume = 0.7;
const fxReload = new Audio('ES_Card%20Swipe%202%20-%20SFX%20Producer.mp3');
const fxHit = new Audio('ES_Human%20Mouth%20Click%201%20-%20SFX%20Producer.mp3');
const fxWave = new Audio('ES_Horror%20Whoosh%201%20-%20SFX%20Producer.mp3');
const fxLose = new Audio('ES_Snowlight%20-%20DEX%201200.mp3');
const fxNear = new Audio('ES_Whoosh%20Metallic%208%20-%20SFX%20Producer.mp3');

const hud = {
  score: document.getElementById('score'),
  health: document.getElementById('health'),
  ammo: document.getElementById('ammo'),
  wave: document.getElementById('wave'),
  modal: document.getElementById('modal'),
  start: document.getElementById('start-btn'),
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const clampPosition = () => {
  const p = controls.getObject().position;
  p.x = THREE.MathUtils.clamp(p.x, -arenaSize + 1, arenaSize - 1);
  p.z = THREE.MathUtils.clamp(p.z, -arenaSize + 1, arenaSize - 1);
};

const spawnTarget = () => {
  const geom = new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 12, 12);
  const target = new THREE.Mesh(geom, pulseMaterial.clone());
  target.material.emissiveIntensity = 0.3 + Math.random() * 0.5;
  const side = Math.random() > 0.5 ? 1 : -1;
  const offset = Math.random() * arenaSize * 0.9;
  target.position.set(side * (arenaSize - 2), 1.2, offset);
  target.userData = {
    dir: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6),
    speed: 2 + Math.random() * 1.5,
    alive: true,
  };
  scene.add(target);
  targets.push(target);
};

const startWave = () => {
  for (let i = 0; i < 4 + wave; i += 1) spawnTarget();
  fxWave.currentTime = 0;
  fxWave.play();
};

const resetGame = () => {
  targets.forEach((t) => scene.remove(t));
  targets.length = 0;
  wave = 1;
  score = 0;
  health = 100;
  ammo = maxAmmo;
  hud.modal.style.display = 'grid';
  hud.modal.querySelector('h1').textContent = 'Volcano Run';
  hud.modal.querySelector('p').textContent = 'WASD to move · Mouse to look · Click to shoot · R to reload';
  updateHUD();
};

const startGame = () => {
  hud.modal.style.display = 'none';
  startWave();
  bgMusic.play().catch(() => {});
  animate();
};

const updateHUD = () => {
  hud.score.textContent = score;
  hud.health.textContent = Math.max(0, Math.floor(health));
  hud.ammo.textContent = ammo;
  hud.wave.textContent = wave;
};

const shoot = () => {
  const now = performance.now();
  if (!controls.isLocked || ammo <= 0 || now - lastShot < 220) return;
  ammo -= 1;
  lastShot = now;
  fxShoot.currentTime = 0;
  fxShoot.play();

  pointer.set(0, 0);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (hit) {
    const target = hit.object;
    target.userData.alive = false;
    score += 15;
    fxHit.currentTime = 0;
    fxHit.play();
    target.material.emissive.set('#ffdf80');
    target.material.color.set('#ffffff');
    setTimeout(() => scene.remove(target), 50);
  }
  updateHUD();
};

const reload = () => {
  if (ammo === maxAmmo) return;
  fxReload.currentTime = 0;
  fxReload.play();
  ammo = maxAmmo;
  updateHUD();
};

const handleDamage = (amount) => {
  health -= amount;
  if (health <= 0) {
    health = 0;
    fxLose.currentTime = 0;
    fxLose.play();
    hud.modal.style.display = 'grid';
    hud.modal.querySelector('h1').textContent = 'You fell into the lava';
    hud.modal.querySelector('p').textContent = `Final Score: ${score} · Waves cleared: ${wave - 1}`;
    controls.unlock();
  }
  updateHUD();
};

const animate = () => {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (controls.isLocked) {
    const speed = 8;
    const direction = new THREE.Vector3();
    direction.z = Number(moveState.backward) - Number(moveState.forward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();
    controls.moveRight(direction.x * delta * speed);
    controls.moveForward(-direction.z * delta * speed);
    clampPosition();
  }

  targets.forEach((target) => {
    if (!target.userData.alive) return;
    const dir = target.userData.dir.clone();
    target.position.addScaledVector(dir, delta * target.userData.speed);

    if (Math.abs(target.position.x) > arenaSize - 1 || Math.abs(target.position.z) > arenaSize - 1) {
      target.userData.dir.x *= -1;
      target.userData.dir.z *= -1;
    }

    const distance = target.position.distanceTo(controls.getObject().position);
    const pulse = Math.sin(performance.now() * 0.005 + distance) * 0.25 + 0.65;
    target.material.emissiveIntensity = pulse;

    if (distance < 2.1) {
      handleDamage(delta * 22);
      if (fxNear.paused) {
        fxNear.currentTime = 0;
        fxNear.play();
      }
    }
  });

  const aliveTargets = targets.filter((t) => t.userData.alive);
  if (aliveTargets.length === 0 && controls.isLocked) {
    wave += 1;
    ammo = maxAmmo;
    startWave();
    updateHUD();
  }

  renderer.render(scene, camera);
};

const onResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

hud.start.addEventListener('click', () => {
  controls.lock();
  startGame();
});

controls.addEventListener('unlock', () => {
  hud.modal.style.display = 'grid';
});

window.addEventListener('resize', onResize);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') moveState.forward = true;
  if (e.code === 'KeyS') moveState.backward = true;
  if (e.code === 'KeyA') moveState.left = true;
  if (e.code === 'KeyD') moveState.right = true;
  if (e.code === 'KeyR') reload();
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') moveState.forward = false;
  if (e.code === 'KeyS') moveState.backward = false;
  if (e.code === 'KeyA') moveState.left = false;
  if (e.code === 'KeyD') moveState.right = false;
});

window.addEventListener('click', shoot);

resetGame();
updateHUD();
