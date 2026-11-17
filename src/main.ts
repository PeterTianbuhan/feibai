// 入口。游戏还没搬进来，能玩的原型在 prototype/index.html。
const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = innerWidth;
canvas.height = innerHeight;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#f2ecdf';
ctx.fillRect(0, 0, canvas.width, canvas.height);
