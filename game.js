const TILE_SIZE = 32;
const LEVEL_COUNT = 10;
let currentLevel = 1;
let player;
let cursors;
let mapData;
let mapLayer;
let loot = [];

const saved = JSON.parse(localStorage.getItem('crawler_save')) || {};
if (saved.level) {
  currentLevel = saved.level;
  loot = saved.loot || [];
}

const config = {
  type: Phaser.AUTO,
  width: 640,
  height: 480,
  parent: 'gameContainer',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: { preload, create, update }
};
let game;

function preload() {
  this.load.image('player', 'https://labs.phaser.io/assets/sprites/phaser-dude.png');
}

function create() {
  generateLevel.call(this);
  player = this.physics.add.sprite(TILE_SIZE, TILE_SIZE, 'player');
  player.setCollideWorldBounds(true);
  cursors = this.input.keyboard.createCursorKeys();
}

function generateLevel() {
  // simple random grid
  mapData = [];
  const size = 15 + currentLevel;
  for (let y = 0; y < size; y++) {
    mapData[y] = [];
    for (let x = 0; x < size; x++) {
      mapData[y][x] = Math.random() < 0.1 ? 1 : 0; // 1 = wall
    }
  }
  const graphics = this.add.graphics();
  graphics.fillStyle(0x444444, 1);
  graphics.fillRect(0, 0, size * TILE_SIZE, size * TILE_SIZE);
  graphics.fillStyle(0x222222, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mapData[y][x] === 1) {
        graphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

function update() {
  const speed = 160;
  player.body.setVelocity(0);
  if (cursors.left.isDown) {
    player.body.setVelocityX(-speed);
  } else if (cursors.right.isDown) {
    player.body.setVelocityX(speed);
  }
  if (cursors.up.isDown) {
    player.body.setVelocityY(-speed);
  } else if (cursors.down.isDown) {
    player.body.setVelocityY(speed);
  }
}

function startGame() {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('gameContainer').style.display = 'block';
  game = new Phaser.Game(config);
}

window.onload = () => {
  document.getElementById('startBtn').addEventListener('click', startGame);
};
