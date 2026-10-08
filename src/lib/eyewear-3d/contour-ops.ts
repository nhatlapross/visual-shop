import * as THREE from 'three';

/** Giới hạn kéo dài mối nối ở góc nhọn, tránh đỉnh văng ra vô tận. */
const MITER_LIMIT = 0.35;

/**
 * Diện tích có dấu theo công thức dây giày.
 * Dương = ngược chiều kim đồng hồ, âm = thuận chiều.
 */
export function contourArea(points: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Lấy điểm từ một Shape/Path, bỏ điểm đóng nếu nó trùng điểm đầu. */
export function shapeToPoints(shape: THREE.Path, segments = 64): THREE.Vector2[] {
  const raw = shape.getPoints(segments);
  return raw.length > 2 && raw[0].distanceTo(raw[raw.length - 1]) < 1e-9
    ? raw.slice(0, -1)
    : raw;
}

/**
 * Nới một contour kín ra phía ngoài một khoảng đều, dùng mối nối miter.
 *
 * Dùng để suy viền ngoài của gọng từ contour lỗ tròng quét được: viền ngoài
 * chính là lỗ tròng nới ra đúng bằng độ dày viền. Nhờ vậy không cần đụng tới
 * silhouette tổng của ảnh — thứ hay nuốt cả càng kính vào.
 */
export function offsetContour(points: THREE.Vector2[], distance: number): THREE.Vector2[] {
  if (points.length < 3) {
    throw new Error(`Contour cần ít nhất 3 điểm để nới, nhận được ${points.length}`);
  }

  // Chiều quấn quyết định đâu là phía ngoài
  const sign = contourArea(points) >= 0 ? 1 : -1;
  const outwardNormal = (from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2 => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Ngược chiều kim đồng hồ thì phía ngoài nằm bên phải cạnh có hướng
    return new THREE.Vector2((dy / len) * sign, (-dx / len) * sign);
  };

  const n = points.length;
  const out: THREE.Vector2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const n1 = outwardNormal(prev, curr);
    const n2 = outwardNormal(curr, next);

    const bx = n1.x + n2.x;
    const by = n1.y + n2.y;
    const blen = Math.hypot(bx, by);

    if (blen < 1e-9) {
      // Hai cạnh ngược hướng nhau hoàn toàn: dùng thẳng pháp tuyến cạnh trước
      out.push(new THREE.Vector2(curr.x + n1.x * distance, curr.y + n1.y * distance));
      continue;
    }

    const bisector = new THREE.Vector2(bx / blen, by / blen);
    const cos = Math.max(MITER_LIMIT, bisector.dot(n1));
    const miter = distance / cos;

    out.push(new THREE.Vector2(curr.x + bisector.x * miter, curr.y + bisector.y * miter));
  }

  return out;
}

/** Dựng THREE.Shape từ danh sách điểm, đóng kín. */
export function pointsToShape(points: THREE.Vector2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i].x, points[i].y);
  s.closePath();
  return s;
}

/** Dựng THREE.Path từ danh sách điểm, đóng kín. */
export function pointsToPath(points: THREE.Vector2[]): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i].x, points[i].y);
  p.closePath();
  return p;
}
