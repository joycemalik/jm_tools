// AI-controlled classic snake background game with emoji food & sketch styling

const EMOJIS = [
  '🧬', '🦠', '🔭', '🧪', '🪐', '🎲', '🧩', '🗺️', 
  '🔬', '📡', '⚛️', '🌀', '🎯', '🧲', '💡', '🪤', 
  '🧿', '🫧', '🪄', '🌊', '⚡', '🗝️', '🔮', '📜'
];

export class SnakeGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.container = canvas.parentElement;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 32;
    this.cols = 0;
    this.rows = 0;
    
    this.snake = [];
    this.dir = { x: 1, y: 0 };
    this.foods = []; // Array of {x, y, emoji}
    
    this.animId = null;
    this.lastTick = 0;
    this.tickInterval = 110; // ms per move
    this.autoSpawnTimer = null;
    
    this.resize = this.resize.bind(this);
    this.handleClick = this.handleClick.bind(this);
  }

  start() {
    window.addEventListener('resize', this.resize);
    // Listen on container (or window) so clicks anywhere on loading screen register
    if (this.container) {
      this.container.addEventListener('click', this.handleClick);
    } else {
      this.canvas.addEventListener('click', this.handleClick);
    }
    this.resize();
    
    // Initial snake setup in center
    const startX = Math.max(3, Math.floor(this.cols / 2));
    const startY = Math.max(3, Math.floor(this.rows / 2));
    this.snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
      { x: startX - 3, y: startY },
      { x: startX - 4, y: startY }
    ];
    this.dir = { x: 1, y: 0 };
    this.foods = [];

    // Spawn initial food items
    for (let i = 0; i < 6; i++) {
      this.spawnRandomFood();
    }

    // Auto-spawn loop (every 1.8 seconds if < 10 items)
    this.autoSpawnTimer = setInterval(() => {
      if (this.foods.length < 10) {
        this.spawnRandomFood();
      }
    }, 1800);

    this.lastTick = performance.now();
    this.loop = this.loop.bind(this);
    this.animId = requestAnimationFrame(this.loop);
  }

  stop() {
    window.removeEventListener('resize', this.resize);
    if (this.container) {
      this.container.removeEventListener('click', this.handleClick);
    }
    this.canvas.removeEventListener('click', this.handleClick);
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.autoSpawnTimer) clearInterval(this.autoSpawnTimer);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.cols = Math.max(8, Math.floor(rect.width / this.cellSize));
    this.rows = Math.max(8, Math.floor(rect.height / this.cellSize));
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const gridX = Math.floor(clickX / this.cellSize);
    const gridY = Math.floor(clickY / this.cellSize);

    if (gridX >= 0 && gridX < this.cols && gridY >= 0 && gridY < this.rows) {
      this.spawnFoodAt(gridX, gridY);
    }
  }

  spawnRandomFood() {
    let x, y, safe = false, attempts = 0;
    while (!safe && attempts < 50) {
      x = Math.floor(Math.random() * this.cols);
      y = Math.floor(Math.random() * this.rows);
      safe = !this.snake.some(s => s.x === x && s.y === y) && 
             !this.foods.some(f => f.x === x && f.y === y);
      attempts++;
    }
    if (safe) {
      const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      this.foods.push({ x, y, emoji, scale: 0.1 });
    }
  }

  spawnFoodAt(x, y) {
    // Replace any food at same grid pos or push new
    this.foods = this.foods.filter(f => !(f.x === x && f.y === y));
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    this.foods.push({ x, y, emoji, scale: 0.1 });
  }

  // AI pathfinder logic (Greedy choice towards nearest food with obstacle avoidance)
  decideNextMove() {
    const head = this.snake[0];

    if (this.foods.length === 0) {
      this.spawnRandomFood();
    }

    // Find closest food
    let closestFood = null;
    let minDist = Infinity;
    for (const f of this.foods) {
      const dist = Math.abs(f.x - head.x) + Math.abs(f.y - head.y);
      if (dist < minDist) {
        minDist = dist;
        closestFood = f;
      }
    }

    const possibleMoves = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];

    // Filter out moves that reverse direction or hit walls or hit snake body
    const validMoves = possibleMoves.filter(m => {
      if (m.x === -this.dir.x && m.y === -this.dir.y) return false; // No reverse
      const nextX = head.x + m.x;
      const nextY = head.y + m.y;
      
      // Wall collision
      if (nextX < 0 || nextX >= this.cols || nextY < 0 || nextY >= this.rows) return false;
      
      // Body collision (ignore tail tip since it moves)
      const bodyCheck = this.snake.slice(0, -1);
      if (bodyCheck.some(s => s.x === nextX && s.y === nextY)) return false;

      return true;
    });

    if (validMoves.length === 0) {
      // trapped! Try any non-reversing wall-bound move or wrap-around reset
      return;
    }

    if (closestFood) {
      // Score moves by distance to target food
      validMoves.sort((a, b) => {
        const distA = Math.abs(head.x + a.x - closestFood.x) + Math.abs(head.y + a.y - closestFood.y);
        const distB = Math.abs(head.x + b.x - closestFood.x) + Math.abs(head.y + b.y - closestFood.y);
        return distA - distB;
      });
    }

    this.dir = validMoves[0];
  }

  update() {
    this.decideNextMove();

    const head = this.snake[0];
    const newHead = { x: head.x + this.dir.x, y: head.y + this.dir.y };

    // Safety check wall collision if trapped
    if (newHead.x < 0 || newHead.x >= this.cols || newHead.y < 0 || newHead.y >= this.rows) {
      // Respawn snake centered
      const startX = Math.floor(this.cols / 2);
      const startY = Math.floor(this.rows / 2);
      this.snake = [
        { x: startX, y: startY },
        { x: startX - 1, y: startY },
        { x: startX - 2, y: startY }
      ];
      this.dir = { x: 1, y: 0 };
      return;
    }

    // Check food eaten
    const foodIndex = this.foods.findIndex(f => f.x === newHead.x && f.y === newHead.y);
    if (foodIndex !== -1) {
      // Eat food: grow snake, remove food
      this.snake.unshift(newHead);
      this.foods.splice(foodIndex, 1);
    } else {
      // Normal move
      this.snake.unshift(newHead);
      this.snake.pop();
    }

    // Animate food scale pop
    for (const f of this.foods) {
      if (f.scale < 1) f.scale = Math.min(1, f.scale + 0.2);
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw grid background faintly (sketch paper dots/lines)
    this.ctx.fillStyle = 'rgba(193, 127, 60, 0.03)';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if ((r + c) % 2 === 0) {
          this.ctx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
        }
      }
    }

    // Draw Foods (Emojis)
    this.ctx.font = `${Math.floor(this.cellSize * 0.85)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#ffffff'; // Ensure non-transparent fill for emoji rendering
    for (const f of this.foods) {
      const cx = f.x * this.cellSize + this.cellSize / 2;
      const cy = f.y * this.cellSize + this.cellSize / 2;
      
      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.scale(f.scale, f.scale);
      this.ctx.fillText(f.emoji, 0, 2);
      this.ctx.restore();
    }

    // Draw Snake
    for (let i = 0; i < this.snake.length; i++) {
      const seg = this.snake[i];
      const isHead = i === 0;
      const px = seg.x * this.cellSize;
      const py = seg.y * this.cellSize;
      const pad = isHead ? 2 : 3;

      this.ctx.save();
      
      if (isHead) {
        // Snake head - warm sketch ink with border
        this.ctx.fillStyle = 'rgba(193, 127, 60, 0.45)';
        this.ctx.strokeStyle = '#c17f3c';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.roundRect(px + pad, py + pad, this.cellSize - pad * 2, this.cellSize - pad * 2, 6);
        this.ctx.fill();
        this.ctx.stroke();

        // Eyes
        this.ctx.fillStyle = '#17140d';
        const eyeOffset = 6;
        let eye1 = { x: px + 7, y: py + 7 };
        let eye2 = { x: px + 15, y: py + 7 };
        if (this.dir.x === 1) { eye1 = { x: px + 15, y: py + 6 }; eye2 = { x: px + 15, y: py + 16 }; }
        else if (this.dir.x === -1) { eye1 = { x: px + 6, y: py + 6 }; eye2 = { x: px + 6, y: py + 16 }; }
        else if (this.dir.y === 1) { eye1 = { x: px + 6, y: py + 15 }; eye2 = { x: px + 16, y: py + 15 }; }

        this.ctx.beginPath();
        this.ctx.arc(eye1.x, eye1.y, 2, 0, Math.PI * 2);
        this.ctx.arc(eye2.x, eye2.y, 2, 0, Math.PI * 2);
        this.ctx.fill();

      } else {
        // Snake body segments - sketched / faded look
        const opacity = Math.max(0.12, 0.4 - (i / this.snake.length) * 0.25);
        this.ctx.fillStyle = `rgba(193, 127, 60, ${opacity})`;
        this.ctx.strokeStyle = `rgba(193, 127, 60, ${opacity + 0.1})`;
        this.ctx.lineWidth = 1;
        
        this.ctx.beginPath();
        this.ctx.roundRect(px + pad, py + pad, this.cellSize - pad * 2, this.cellSize - pad * 2, 4);
        this.ctx.fill();
        this.ctx.stroke();
      }

      this.ctx.restore();
    }
  }

  loop(now) {
    if (now - this.lastTick >= this.tickInterval) {
      this.update();
      this.lastTick = now;
    }
    this.draw();
    this.animId = requestAnimationFrame(this.loop);
  }
}
