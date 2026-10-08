import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  SwitchCamera,
  Camera,
  UploadCloud,
  Info,
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Box,
  Glasses,
  Check,
  X,
  RefreshCw,
  Download,
  Calendar,
  ShieldCheck,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';

// ==========================================
// 1. DATA MODELS & PRODUCT CATALOG
// ==========================================
export interface RealGlassesItem {
  id: string;
  brand: string;
  name: string;
  category: string;
  categoryKey: string;
  price: string;
  shape: 'aviator' | 'clubmaster' | 'square' | 'rimless' | 'cateye' | 'round' | 'geometric';
  shapeLabel?: string;
  bestForFaces: ('oval' | 'round' | 'square' | 'heart' | 'diamond')[];
  description: string;
  material: string;
  weight: string;
  lensType: string;
  tag: string;
  image?: string;
  model3dUrl?: string;
  colors: {
    name: string;
    hex: string;
    frameColor: string;
    templeColor: string;
    lensGradient: string;
  }[];
}

export function normalizeGlassesShape(rawShape?: string): 'aviator' | 'clubmaster' | 'square' | 'rimless' | 'cateye' | 'round' | 'geometric' {
  const s = String(rawShape || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('cat') || s.includes('meo') || s.includes('cateye')) return 'cateye';
  if (s.includes('aviator') || s.includes('phicong') || s.includes('pilot')) return 'aviator';
  if (s.includes('round') || s.includes('tron') || s.includes('circle')) return 'round';
  if (s.includes('rimless') || s.includes('khoan') || s.includes('khongvien') || s.includes('frameless')) return 'rimless';
  if (s.includes('club') || s.includes('browline') || s.includes('nua') || s.includes('half')) return 'clubmaster';
  if (s.includes('geo') || s.includes('dagiac') || s.includes('lucgiac') || s.includes('batgiac') || s.includes('polygon') || s.includes('oval')) return 'geometric';
  if (s.includes('square') || s.includes('vuong') || s.includes('chunhat') || s.includes('rectangle') || s.includes('box')) return 'square';
  return 'square';
}

export function computeBestForFaces(shape: string, explicitList?: string[]): ('oval' | 'round' | 'square' | 'heart' | 'diamond')[] {
  // An explicitly empty list means this product has not been classified.
  if (Array.isArray(explicitList) && explicitList.length === 0) return [];
  // If explicitly configured with a custom subset of face shapes, use it
  if (explicitList && Array.isArray(explicitList) && explicitList.length > 0 && explicitList.length < 5) {
    return explicitList as ('oval' | 'round' | 'square' | 'heart' | 'diamond')[];
  }
  // Otherwise compute the optimal optical face matching according to facial geometry
  switch (shape) {
    case 'square':
      return ['round', 'oval', 'heart'];
    case 'round':
      return ['square', 'heart', 'diamond', 'oval'];
    case 'cateye':
      return ['square', 'diamond', 'oval', 'round'];
    case 'aviator':
      return ['square', 'heart', 'oval'];
    case 'rimless':
      return ['oval', 'diamond', 'square', 'heart', 'round'];
    case 'geometric':
      return ['round', 'oval', 'heart'];
    case 'clubmaster':
      return ['oval', 'round', 'diamond'];
    default:
      return ['oval', 'round', 'square', 'heart', 'diamond'];
  }
}

export function detectEyewearProfile(p: any): {
  shape: 'aviator' | 'clubmaster' | 'square' | 'rimless' | 'cateye' | 'round' | 'geometric';
  frameColor: string;
  templeColor: string;
  colorName: string;
  isWoodTemples: boolean;
} {
  // 1. PRIORITY #1: Explicit frameShape entered in Inventory Management (Quản lý kho)
  let shape: 'aviator' | 'clubmaster' | 'square' | 'rimless' | 'cateye' | 'round' | 'geometric' = 'square';

  if (p.frameShape && typeof p.frameShape === 'string' && p.frameShape.trim() !== '') {
    shape = normalizeGlassesShape(p.frameShape);
  } else {
    // Fallback: Smart Keyword detection from product name, description & category
    const fullText = `${p.name || ''} ${p.description || ''} ${p.category || ''}`.toLowerCase();
    if (fullText.includes('meo') || fullText.includes('cat') || fullText.includes('cateye')) {
      shape = 'cateye';
    } else if (fullText.includes('phi cong') || fullText.includes('aviator') || fullText.includes('pilot')) {
      shape = 'aviator';
    } else if (fullText.includes('tron') || fullText.includes('round') || fullText.includes('circle')) {
      shape = 'round';
    } else if (fullText.includes('khoan') || fullText.includes('rimless') || fullText.includes('khongvien') || fullText.includes('frameless')) {
      shape = 'rimless';
    } else if (fullText.includes('nua') || fullText.includes('clubmaster') || fullText.includes('browline')) {
      shape = 'clubmaster';
    } else if (fullText.includes('geo') || fullText.includes('dagiac') || fullText.includes('lucgiac') || fullText.includes('batgiac') || fullText.includes('oval')) {
      shape = 'geometric';
    } else if (fullText.includes('vuong') || fullText.includes('square') || fullText.includes('chunhat') || fullText.includes('rectangle') || fullText.includes('box')) {
      shape = 'square';
    }
  }

  // 2. Detect Color & Materials
  const fullText = `${p.name || ''} ${p.description || ''} ${p.frameMaterial || ''} ${p.brand || ''} ${p.category || ''} ${p.colorName || ''}`.toLowerCase();
  const hasWood = fullText.includes('chân gỗ') || fullText.includes('càng gỗ') || fullText.includes('gỗ') || fullText.includes('wood');
  const hasBlack = fullText.includes('đen') || fullText.includes('black') || fullText.includes('matte black');
  const hasTortoise = fullText.includes('đồi mồi') || fullText.includes('tortoise') || fullText.includes('nâu') || fullText.includes('brown') || fullText.includes('havana');
  const hasSilver = fullText.includes('bạc') || fullText.includes('silver') || fullText.includes('titanium xám') || fullText.includes('trắng');
  const hasGold = fullText.includes('vàng') || fullText.includes('gold') || fullText.includes('18k') || fullText.includes('24k');
  const hasRose = fullText.includes('hồng') || fullText.includes('rose');
  const hasClear = fullText.includes('trong suốt') || fullText.includes('crystal') || fullText.includes('clear');

  let frameColor = '#18181B';
  let templeColor = '#18181B';
  let colorName = p.colorName || '';

  if (hasBlack && hasWood) {
    frameColor = '#18181B'; // Jet Black Acetate front frame
    templeColor = '#C89D65'; // Natural Oak Wood temple legs
    colorName = colorName || 'Nhựa Đen & Càng Gỗ';
  } else if (hasWood) {
    frameColor = '#3F2E21';
    templeColor = '#C89D65';
    colorName = colorName || 'Gỗ Tự Nhiên';
  } else if (hasTortoise) {
    frameColor = '#78350F';
    templeColor = '#92400E';
    colorName = colorName || 'Đồi Mồi Vintage';
  } else if (hasClear) {
    frameColor = 'rgba(255,255,255,0.75)';
    templeColor = 'rgba(255,255,255,0.9)';
    colorName = colorName || 'Nhựa Trong Suốt';
  } else if (hasSilver) {
    frameColor = '#CBD5E1';
    templeColor = '#94A3B8';
    colorName = colorName || 'Bạc Titanium';
  } else if (hasGold) {
    frameColor = '#D4AF37';
    templeColor = '#E8C97A';
    colorName = colorName || 'Vàng Gold 18K';
  } else if (hasRose) {
    frameColor = '#F472B6';
    templeColor = '#FB7185';
    colorName = colorName || 'Vàng Hồng 18K';
  } else if (hasBlack) {
    frameColor = '#18181B';
    templeColor = '#27272A';
    colorName = colorName || 'Đen Acetate';
  } else if (p.colorHex && p.colorHex !== '#D4AF37') {
    frameColor = p.colorHex;
    templeColor = p.colorHex;
    colorName = p.colorName || 'Màu tiêu chuẩn';
  } else {
    frameColor = '#1E293B';
    templeColor = '#334155';
    colorName = colorName || (p.model3dUrl ? 'Theo mô hình 3D' : 'Chưa xác định');
  }

  return {
    shape,
    frameColor,
    templeColor,
    colorName,
    isWoodTemples: hasWood
  };
}

export function convertProductToGlassesItem(p: any): RealGlassesItem {
  const priceFormatted = typeof p.unitPrice === 'number' && Number.isFinite(p.unitPrice) && p.unitPrice > 0
    ? new Intl.NumberFormat('vi-VN').format(p.unitPrice) + 'đ'
    : 'Liên hệ';

  const profile = detectEyewearProfile(p);
  const shape = profile.shape;
  const bestForFaces = computeBestForFaces(shape, p.bestForFaces);

  return {
    id: p._id || p.productCode || String(Math.random()),
    brand: p.brand || 'Chưa xác định',
    name: p.name || 'Gọng kính',
    category: p.frameMaterial || 'Gọng kính',
    categoryKey: bestForFaces.length > 0 ? shape : 'unclassified',
    price: priceFormatted,
    shape: shape,
    shapeLabel: bestForFaces.length > 0 && p.frameShape ? p.frameShape : 'Chưa xác định',
    bestForFaces: bestForFaces,
    description: p.description || 'Thông tin sản phẩm đang được cập nhật.',
    material: p.frameMaterial || 'Chưa xác định',
    weight: p.weight || 'Chưa xác định',
    lensType: p.lensType || 'Chưa xác định',
    tag: p.model3dUrl ? 'Mô hình 3D' : 'Gọng kính',
    model3dUrl: p.model3dUrl || undefined,
    image: p.image || undefined,
    colors: [
      {
        name: profile.colorName,
        hex: profile.frameColor,
        frameColor: profile.frameColor,
        templeColor: profile.templeColor,
        lensGradient: `${profile.frameColor}26`
      }
    ]
  };
}

export async function loadActiveFrameProducts(id?: string): Promise<any[]> {
  // Old sample IDs and malformed deep links cannot identify an inventory product.
  if (id !== undefined && !/^[a-f\d]{24}$/i.test(id)) return [];

  const params = new URLSearchParams({ category: 'frame', activeOnly: 'true', limit: '500' });
  if (id) params.set('ids', id);
  const response = await fetch(`/api/products?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Không thể tải danh mục gọng kính.');

  const data = await response.json();
  if (!Array.isArray(data.products)) throw new Error('Danh mục gọng kính không hợp lệ.');

  return data.products.filter((product: any) =>
    product?.isActive === true && product.category === 'frame' &&
    typeof product._id === 'string' && (!id || product._id === id)
  );
}

export type FaceShapeType = 'oval' | 'round' | 'square' | 'heart' | 'diamond';

// ==========================================
// 2. SCIENTIFIC OPTICAL FACE-GLASSES MATCHING ENGINE
// ==========================================
export interface MatchAnalysisResult {
  score: number | null;
  tier: 'excellent' | 'good' | 'moderate' | 'poor';
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  reason: string;
  tip: string;
}

export function analyzeFaceGlassesCompatibility(faceShape: FaceShapeType, glasses?: RealGlassesItem | null): MatchAnalysisResult {
  if (!glasses || glasses.bestForFaces.length === 0) {
    return {
      score: null,
      tier: 'moderate',
      badgeLabel: 'Chưa đánh giá',
      badgeColor: '#94A3B8',
      badgeBg: 'rgba(148, 163, 184, 0.15)',
      reason: glasses ? 'Chưa có thông tin dáng kính để đánh giá độ phù hợp.' : 'Chọn mẫu kính để thử trên khuôn mặt.',
      tip: 'Bạn có thể thử mô hình 3D và điều chỉnh vị trí kính.'
    };
  }
  const shape = glasses.shape;
  let score = 70;
  let reason = '';
  let tip = '';

  switch (faceShape) {
    case 'round': // Mặt Tròn
      if (shape === 'square') {
        score = 98;
        reason = 'Đường nét vuông dứt khoát tạo góc cạnh tương phản, giúp khuôn mặt trông thon gọn và có chiều sâu.';
        tip = 'Lựa chọn số 1 tối ưu cho mặt tròn!';
      } else if (shape === 'geometric') {
        score = 95;
        reason = 'Góc cắt lục giác tạo điểm nhấn sắc nét và phong cách hiện đại cho gò má đầy đặn.';
        tip = 'Tạo điểm nhấn sắc sảo, cá tính.';
      } else if (shape === 'cateye') {
        score = 92;
        reason = 'Đuôi mắt xếch lên giúp nâng cơ mặt quang học, làm diện mạo thanh thoát hơn.';
        tip = 'Tạo nét nữ tính, trẻ trung.';
      } else if (shape === 'clubmaster') {
        score = 88;
        reason = 'Bán gọng viền trên hướng sự chú ý lên chân mày và mắt, giảm cảm giác tròn ở phần cằm.';
        tip = 'Rất thanh thoát và đĩnh đạc.';
      } else if (shape === 'aviator') {
        score = 82;
        reason = 'Dáng giọt nước bo cong nhẹ mở rộng diện tích tròng nhưng cần gọng có thanh ngang thẳng.';
        tip = 'Phong cách phóng khoáng.';
      } else if (shape === 'rimless') {
        score = 75;
        reason = 'Gọng không viền giữ nét tự nhiên nhưng ít tạo hiệu ứng thon gọn cho khuôn mặt.';
        tip = 'Phù hợp nếu chuộng sự tối giản.';
      } else if (shape === 'round') {
        score = 48;
        reason = 'Gọng tròn lặp lại đường cong của mặt, làm khuôn mặt có cảm giác tròn và đầy hơn thực tế.';
        tip = 'Bác sĩ khuyên nên đổi sang gọng Vuông hoặc Đa giác để mặt thon gọn hơn.';
      }
      break;

    case 'square': // Mặt Vuông
      if (shape === 'round') {
        score = 98;
        reason = 'Đường cong mềm mại của gọng tròn giúp trung hòa và làm dịu góc quai hàm vuông vức.';
        tip = 'Lựa chọn số 1 giúp gương mặt mềm mại, thanh tú!';
      } else if (shape === 'aviator') {
        score = 96;
        reason = 'Dáng phi công giọt nước bo tròn mở rộng chiều sâu, cân đối tuyệt vời với xương hàm.';
        tip = 'Tạo thần thái sang trọng, phong độ.';
      } else if (shape === 'cateye') {
        score = 92;
        reason = 'Đuôi xếch bo tròn làm dịu các góc cạnh vuông và tôn xương gò má.';
        tip = 'Rất quyến rũ và thanh tú.';
      } else if (shape === 'rimless') {
        score = 90;
        reason = 'Không viền giúp giảm độ nặng của khung xương mặt, tạo vẻ thanh thoát tự nhiên.';
        tip = 'Nhẹ nhàng và tinh tế.';
      } else if (shape === 'clubmaster') {
        score = 80;
        reason = 'Nửa viền trên tạo điểm nhấn nhưng cần chọn mẫu viền dưới bo tròn.';
        tip = 'Phong cách cổ điển.';
      } else if (shape === 'geometric') {
        score = 65;
        reason = 'Đường cắt lục giác có thể làm gương mặt trông nhiều góc cạnh hơn.';
        tip = 'Nên chọn mẫu lục giác có bo tròn góc.';
      } else if (shape === 'square') {
        score = 52;
        reason = 'Gọng vuông góc cạnh sẽ nhấn mạnh thêm độ vuông của xương hàm.';
        tip = 'Bác sĩ khuyên nên chọn gọng Tròn, Oval hoặc Aviator để làm mềm nét mặt.';
      }
      break;

    case 'oval': // Mặt Trái Xoan (Tỷ Lệ Vàng)
      if (shape === 'aviator') {
        score = 98;
        reason = 'Tỷ lệ hoàng kim của mặt trái xoan tôn trọn vẻ lịch lãm của gọng phi công.';
        tip = 'Hợp xuất sắc 98%!';
      } else if (shape === 'square') {
        score = 96;
        reason = 'Dáng vuông tạo thêm nét cá tính, hiện đại trên khuôn mặt cân đối.';
        tip = 'Rất thời trang và thanh lịch.';
      } else if (shape === 'rimless') {
        score = 97;
        reason = 'Tôn vinh trọn vẹn nét đẹp tự nhiên, không che khuất bất kỳ đường nét nào.';
        tip = 'Vẻ đẹp tinh tế, sang trọng.';
      } else if (shape === 'clubmaster') {
        score = 95;
        reason = 'Tôn dáng chân mày và phong thái học giả tri thức.';
        tip = 'Rất đĩnh đạc.';
      } else if (shape === 'cateye') {
        score = 94;
        reason = 'Khoe trọn vầng trán thanh tú và gò má cao quý phái.';
        tip = 'Quý phái và sắc sảo.';
      } else if (shape === 'round') {
        score = 92;
        reason = 'Phong cách nghệ thuật cổ điển, thư sinh.';
        tip = 'Trẻ trung, trí thức.';
      } else {
        score = 95;
        reason = 'Mặt trái xoan hợp với hầu hết mọi dáng kính.';
        tip = 'Tự tin diện mọi phong cách!';
      }
      break;

    case 'heart': // Mặt Trái Tim
      if (shape === 'rimless') {
        score = 98;
        reason = 'Gọng không viền không làm nặng phần trán rộng, giữ sự cân bằng tối ưu với cằm nhọn.';
        tip = 'Lựa chọn hoàn hảo nhất cho mặt trái tim!';
      } else if (shape === 'aviator') {
        score = 95;
        reason = 'Đáy gọng bè rộng hướng xuống giúp cân bằng với phần cằm thon nhỏ.';
        tip = 'Rất hài hòa và phóng khoáng.';
      } else if (shape === 'round') {
        score = 92;
        reason = 'Đường cong mềm mại làm dịu phần trán và tôn cằm v-line thanh tú.';
        tip = 'Thanh thoát, nhẹ nhàng.';
      } else if (shape === 'clubmaster') {
        score = 82;
        reason = 'Viền trên đậm có thể thu hút thêm sự chú ý vào trán rộng.';
        tip = 'Nên chọn bản viền trên mỏng hoặc màu sáng.';
      } else if (shape === 'cateye') {
        score = 78;
        reason = 'Đuôi xếch mở rộng thêm chiều ngang của vùng trán.';
        tip = 'Nên chọn mắt mèo dáng nhỏ mềm mại.';
      } else if (shape === 'square') {
        score = 60;
        reason = 'Gọng vuông bản to dày làm nửa trên khuôn mặt có cảm giác nặng nề hơn.';
        tip = 'Bác sĩ khuyên nên chọn gọng Khoan hoặc Phi công thanh mảnh.';
      }
      break;

    case 'diamond': // Mặt Kim Cương
      if (shape === 'cateye') {
        score = 98;
        reason = 'Đuôi mắt xếch mở rộng vùng thái dương hẹp, cân đối hoàn hảo với gò má.';
        tip = 'Tôn nét kiêu sa, sang trọng bậc nhất!';
      } else if (shape === 'clubmaster') {
        score = 96;
        reason = 'Viền trên nhấn mạnh đường chân mày, mở rộng phần trán thanh tú.';
        tip = 'Phong cách thời thượng.';
      } else if (shape === 'rimless') {
        score = 94;
        reason = 'Làm dịu góc gò má cao và tôn đôi mắt sáng.';
        tip = 'Nhẹ nhàng và thanh lịch.';
      } else if (shape === 'round') {
        score = 90;
        reason = 'Đường cong bo tròn làm mềm phần xương gò má nhô cao.';
        tip = 'Hài hòa, trẻ trung.';
      } else if (shape === 'aviator') {
        score = 88;
        reason = 'Tạo cảm giác trán và cằm rộng hơn, cân đối với gò má.';
        tip = 'Phong cách sành điệu.';
      } else if (shape === 'square') {
        score = 64;
        reason = 'Bản vuông hẹp có thể làm nổi bật thêm độ rộng của gò má.';
        tip = 'Nên chọn dáng mắt mèo hoặc bán gọng để tôn dáng mặt hơn.';
      }
      break;
  }

  let tier: 'excellent' | 'good' | 'moderate' | 'poor' = 'excellent';
  let badgeLabel = `Cực Hợp ${score}%`;
  let badgeColor = '#10B981';
  let badgeBg = 'rgba(16, 185, 129, 0.22)';

  if (score >= 90) {
    tier = 'excellent';
    badgeLabel = `Cực Hợp ${score}%`;
    badgeColor = '#10B981';
    badgeBg = 'rgba(16, 185, 129, 0.22)';
  } else if (score >= 80) {
    tier = 'good';
    badgeLabel = `Hài Hòa ${score}%`;
    badgeColor = '#3B82F6';
    badgeBg = 'rgba(59, 130, 246, 0.22)';
  } else if (score >= 65) {
    tier = 'moderate';
    badgeLabel = `Tạm Ổn ${score}%`;
    badgeColor = '#EAB308';
    badgeBg = 'rgba(234, 179, 8, 0.22)';
  } else {
    tier = 'poor';
    badgeLabel = `Cân Nhắc ${score}%`;
    badgeColor = '#EF4444';
    badgeBg = 'rgba(239, 68, 68, 0.22)';
  }

  return {
    score,
    tier,
    badgeLabel,
    badgeColor,
    badgeBg,
    reason,
    tip
  };
}

export interface SelectedGlassesData {
  id: string;
  name: string;
  brand: string;
  price: string;
  colorName: string;
  colorHex: string;
}

// ==========================================
// 2.5 INTERACTIVE 3D MODEL 360° INSPECTOR MODAL
// ==========================================
interface Interactive3DViewerModalProps {
  glasses: RealGlassesItem;
  selectedColorIdx: number;
  onSelectColor: (idx: number) => void;
  onClose: () => void;
  onTryOnNow: () => void;
  onBookNow: () => void;
}

function Interactive3DViewerModal({
  glasses,
  selectedColorIdx,
  onSelectColor,
  onClose,
  onTryOnNow,
  onBookNow
}: Interactive3DViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAutoRotate, setIsAutoRotate] = useState<boolean>(true);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(10);

  useEffect(() => {
    if (!canvasRef.current || !glasses.model3dUrl) return;
    let isCancelled = false;
    let envTexture: any = null;
    let animFrameId: number;

    let scene: any;
    let camera: any;
    let renderer: any;
    let modelGroup: any;

    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let targetRotationX = 0.15;
    let targetRotationY = 0.4;
    let currentRotationX = 0.15;
    let currentRotationY = 0.4;
    let targetZoom = 1.0;
    let currentZoom = 1.0;

    async function initViewer() {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

        if (isCancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const width = canvas.clientWidth || 600;
        const height = canvas.clientHeight || 450;

        canvas.width = width;
        canvas.height = height;

        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
        camera.position.set(0, 0.05, 0.45);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Studio lighting — ánh sáng nền do environment map bên dưới đảm nhiệm,
        // nên bỏ AmbientLight và giảm đèn hướng, tránh cháy sáng gọng kim loại.
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
        keyLight.position.set(2, 4, 3);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xd4af37, 0.4);
        fillLight.position.set(-3, 1, 2);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.6);
        rimLight.position.set(0, -2, -3);
        scene.add(rimLight);

        // Environment map: transmission/ior/clearcoat của tròng kính lấy mẫu từ đây.
        // Thiếu nó thì tròng đẹp trong studio nhưng phẳng lì khi vào AR.
        const { createStudioEnvironment } = await import('@/lib/eyewear-3d/environment');
        createStudioEnvironment(renderer!)
          .then((tex) => {
            if (isCancelled) { tex.dispose(); return; }
            envTexture = tex;
            scene!.environment = tex;
          })
          .catch((err) => console.warn('[AR] Không dựng được environment map:', err));

        modelGroup = new THREE.Group();
        scene.add(modelGroup);

        const loader = new GLTFLoader();
        loader.load(
          glasses.model3dUrl!,
          (gltf: any) => {
            if (isCancelled) return;
            setLoadingProgress(null);
            const model = gltf.scene;

            // Center model in 3D group
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;

            // Normalize scale so it fits standard view
            const normScale = 0.30 / maxDim;
            model.scale.set(normScale, normScale, normScale);
            model.position.set(-center.x * normScale, -center.y * normScale, -center.z * normScale);

            modelGroup.add(model);
          },
          (prog: any) => {
            if (prog.total && prog.total > 0) {
              setLoadingProgress(Math.min(99, Math.round((prog.loaded / prog.total) * 100)));
            }
          },
          (err: any) => {
            console.error('Error loading 3D viewer model:', err);
            setLoadingProgress(null);
          }
        );

        // Interaction handlers (Mouse drag & Touch drag)
        const onPointerDown = (e: PointerEvent) => {
          isDragging = true;
          previousMousePosition = { x: e.clientX, y: e.clientY };
        };

        const onPointerMove = (e: PointerEvent) => {
          if (!isDragging) return;
          const deltaX = e.clientX - previousMousePosition.x;
          const deltaY = e.clientY - previousMousePosition.y;

          targetRotationY += deltaX * 0.008;
          targetRotationX += deltaY * 0.008;
          targetRotationX = Math.max(-1.2, Math.min(1.2, targetRotationX));

          previousMousePosition = { x: e.clientX, y: e.clientY };
        };

        const onPointerUp = () => {
          isDragging = false;
        };

        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          targetZoom += e.deltaY * -0.001;
          targetZoom = Math.max(0.6, Math.min(2.2, targetZoom));
        };

        canvas.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        function animate() {
          if (isCancelled) return;

          if (isAutoRotate && !isDragging) {
            targetRotationY += 0.008;
          }

          currentRotationX += (targetRotationX - currentRotationX) * 0.1;
          currentRotationY += (targetRotationY - currentRotationY) * 0.1;
          currentZoom += (targetZoom - currentZoom) * 0.1;

          if (modelGroup) {
            modelGroup.rotation.x = currentRotationX;
            modelGroup.rotation.y = currentRotationY;
            modelGroup.scale.set(currentZoom, currentZoom, currentZoom);
          }

          renderer.render(scene, camera);
          animFrameId = requestAnimationFrame(animate);
        }

        animate();

        return () => {
          canvas.removeEventListener('pointerdown', onPointerDown);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          canvas.removeEventListener('wheel', onWheel);
        };
      } catch (err) {
        console.error('Error initializing 3D viewer:', err);
      }
    }

    initViewer();

    return () => {
      isCancelled = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      envTexture?.dispose();
      if (renderer) renderer.dispose();
    };
  }, [glasses.model3dUrl, isAutoRotate]);

  return (
    <div className="ar-3d-modal-overlay" onClick={onClose}>
      <div className="ar-3d-modal-card luxury-modal-glow" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ar-3d-modal-header">
          <div className="flex items-center gap-3">
            <span className="ar-3d-tag-gold flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-amber-300" />
              <span>3D MODEL 360° INSPECTOR</span>
            </span>
            <span className="active-brand-tag">{glasses.brand}</span>
          </div>
          <button type="button" onClick={onClose} className="diag-close-lux" title="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="ar-3d-modal-body">
          <div className="ar-3d-canvas-wrapper">
            <canvas ref={canvasRef} className="ar-3d-interactive-canvas" />

            {loadingProgress !== null && (
              <div className="ar-3d-loading-overlay">
                <div className="loading-spinner-gold" />
                <span className="text-sm font-bold text-amber-400 mt-2 flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Đang tải mô hình 3D... {loadingProgress}%</span>
                </span>
              </div>
            )}

            <div className="ar-3d-drag-hint">
              <span className="flex items-center gap-1.5 justify-center">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Kéo chuột / vuốt để xoay 360° • Cuộn để phóng to</span>
              </span>
            </div>

            {/* Quick 3D Floating Action Tools */}
            <div className="ar-3d-floating-controls">
              <button
                type="button"
                className={`ctrl-3d-btn flex items-center justify-center gap-1.5 ${isAutoRotate ? 'active' : ''}`}
                onClick={() => setIsAutoRotate(!isAutoRotate)}
                title="Bật/Tắt tự động xoay"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAutoRotate ? 'animate-spin' : ''}`} />
                <span className="whitespace-nowrap">{isAutoRotate ? 'Dừng Xoay' : 'Tự Động Xoay'}</span>
              </button>
              <button
                type="button"
                className="ctrl-3d-btn flex items-center justify-center gap-1.5"
                onClick={() => {
                  setIsAutoRotate(false);
                }}
                title="Khởi tạo lại góc nhìn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">Góc Chuẩn</span>
              </button>
            </div>
          </div>

          {/* Specs & Frame Action Info */}
          <div className="ar-3d-info-sidebar">
            <div className="ar-3d-info-top">
              <span className="ar-3d-brand">{glasses.brand}</span>
              <h3 className="ar-3d-title">{glasses.name}</h3>
              <div className="ar-3d-price-row">
                <span className="ar-3d-price">{glasses.price}</span>
                <span className="ar-3d-badge-instock flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Có mô hình 3D</span>
                </span>
              </div>
            </div>

            {/* Specs Table */}
            <div className="ar-3d-specs-table">
              <div className="spec-row">
                <span className="spec-label">Chất liệu:</span>
                <strong className="spec-val text-white">{glasses.material}</strong>
              </div>
              <div className="spec-row">
                <span className="spec-label">Dáng mắt kính:</span>
                <strong className="spec-val capitalize text-amber-400">{glasses.shapeLabel || 'Chưa xác định'}</strong>
              </div>
              <div className="spec-row">
                <span className="spec-label">Công nghệ 3D:</span>
                <strong className="spec-val text-emerald-400">Mô hình GLB</strong>
              </div>
            </div>

            {/* Color Swatches */}
            <div className="ar-3d-color-picker">
              <span className="text-xs font-bold text-slate-300">
                Màu sắc: <span className="text-amber-400">{glasses.colors[selectedColorIdx]?.name}</span>
              </span>
              <div className="swatches-pill-list mt-2">
                {glasses.colors.map((c, idx) => (
                  <button
                    key={c.name}
                    type="button"
                    className={`swatch-pill-btn ${selectedColorIdx === idx ? 'active' : ''}`}
                    onClick={() => onSelectColor(idx)}
                    style={{ backgroundColor: c.hex }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            {/* Action CTAs */}
            <div className="ar-3d-action-buttons">
              <button
                type="button"
                className="ar-3d-tryon-cta-btn flex items-center justify-center gap-2"
                onClick={() => {
                  onClose();
                  onTryOnNow();
                }}
              >
                <Glasses className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <span className="whitespace-nowrap">Thử Kính Trên Mặt Ngay</span>
              </button>
              <button
                type="button"
                className="ar-3d-book-cta-btn flex items-center justify-center gap-2"
                onClick={() => {
                  onClose();
                  onBookNow();
                }}
              >
                <Sparkles className="w-4 h-4 fill-slate-950 text-slate-950 flex-shrink-0" />
                <span className="whitespace-nowrap">Đặt Lịch Giữ Mẫu (-10%)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface AIARTryOnStudioProps {
  onSelectGlasses?: (glasses: SelectedGlassesData) => void;
  selectedGlassesId?: string | null;
  onClose?: () => void;
}

const thumbnail3DCache = new Map<string, string>();

async function generate3DThumbnail(modelUrl: string): Promise<string> {
  if (!modelUrl || typeof window === 'undefined') return '';
  if (thumbnail3DCache.has(modelUrl)) {
    return thumbnail3DCache.get(modelUrl)!;
  }

  try {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    return new Promise((resolve) => {
      try {
        const width = 320;
        const height = 160;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(width, height, false);
        renderer.setPixelRatio(2);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(36, width / height, 0.05, 10);
        camera.position.set(0, 0.01, 0.42);

        // Ánh sáng nền do environment map bên dưới đảm nhiệm; bỏ AmbientLight
        // và giảm đèn hướng để gọng kim loại không bị cháy trắng.
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
        keyLight.position.set(0.8, 1.2, 1.5);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.5);
        fillLight.position.set(-1.0, 0.5, 1.0);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffedd5, 0.8);
        rimLight.position.set(0, 1.0, -1.0);
        scene.add(rimLight);

        // Render một lần rồi dispose, nên phải chờ env sẵn sàng trước khi render.
        const envPromise = import('@/lib/eyewear-3d/environment')
          .then((m) => m.createStudioEnvironment(renderer))
          .catch(() => null);

        const loader = new GLTFLoader();
        loader.load(
          modelUrl,
          async (gltf: any) => {
            const envTex = await envPromise;
            if (envTex) scene.environment = envTex;
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;

            // Frame model larger to fill the preview beautifully
            const scale = 0.38 / maxDim;
            model.scale.set(scale, scale, scale);
            model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
            model.rotation.set(0.04, -0.15, 0);

            scene.add(model);
            renderer.render(scene, camera);

            const dataUrl = canvas.toDataURL('image/png');
            thumbnail3DCache.set(modelUrl, dataUrl);
            envTex?.dispose();
            renderer.dispose();
            resolve(dataUrl);
          },
          undefined,
          (err: any) => {
            console.warn('[3D Thumbnail] Failed to load 3D model for snapshot:', modelUrl, err);
            renderer.dispose();
            resolve('');
          }
        );
      } catch (e) {
        console.warn('[3D Thumbnail] Error rendering 3D thumbnail:', e);
        resolve('');
      }
    });
  } catch (err) {
    console.warn('[3D Thumbnail] Failed to load Three.js libraries:', err);
    return '';
  }
}

export const AIARTryOnStudio: React.FC<AIARTryOnStudioProps> = ({
  onSelectGlasses,
  selectedGlassesId,
  onClose
}) => {
  // Dynamic Real Glasses Catalog from Database
  const [glassesCatalog, setGlassesCatalog] = useState<RealGlassesItem[]>([]);
  const [modelThumbnails, setModelThumbnails] = useState<Record<string, string>>({});
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);

  // Category & Selected Glasses State
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedGlasses, setSelectedGlasses] = useState<RealGlassesItem | null>(null);
  const [selectedColorIdx, setSelectedColorIdx] = useState<number>(0);
  const [filterByMyFace, setFilterByMyFace] = useState<boolean>(false);

  // Fetch real products from Database
  useEffect(() => {
    let isMounted = true;
    async function loadProductsFromDB() {
      try {
        setIsLoadingCatalog(true);
        setCatalogError(null);
        const productsList = await loadActiveFrameProducts();
        const mapped = productsList.map(convertProductToGlassesItem);
        if (isMounted) {
          setGlassesCatalog(mapped);
          setSelectedGlasses(prev =>
            mapped.find((g: RealGlassesItem) => g.id === (selectedGlassesId || prev?.id)) || mapped[0] || null
          );
          setSelectedColorIdx(0);
        }
      } catch {
        if (isMounted) {
          setGlassesCatalog([]);
          setSelectedGlasses(null);
          setCatalogError('Không thể tải danh mục gọng kính. Vui lòng thử lại sau.');
        }
      } finally {
        if (isMounted) setIsLoadingCatalog(false);
      }
    }
    loadProductsFromDB();
    return () => { isMounted = false; };
  }, [selectedGlassesId]);

  // Generate real 3D snapshots for any product with a 3D model
  useEffect(() => {
    if (glassesCatalog.length === 0) return;
    let isCancelled = false;

    glassesCatalog.forEach(async (item) => {
      if (item.model3dUrl && !modelThumbnails[item.id]) {
        const thumb = await generate3DThumbnail(item.model3dUrl);
        if (thumb && !isCancelled) {
          setModelThumbnails(prev => ({ ...prev, [item.id]: thumb }));
        }
      }
    });

    return () => { isCancelled = true; };
  }, [glassesCatalog]);

  // Three.js 3D Model Refs
  const threeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeContextRef = useRef<{
    renderer: any;
    scene: any;
    camera: any;
    pivotGroup?: any;
    modelBaseWidth?: number;
    isModelReady?: boolean;
    currentModel?: any;
    headOccluder?: any;
    leftOccluder?: any;
    rightOccluder?: any;
  } | null>(null);

  // In-App Direct Booking Modal State
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);
  const [bookingFormData, setBookingFormData] = useState({
    fullName: '',
    phone: '',
    appointmentDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    appointmentTime: '09:30',
    gender: 'male',
    serviceType: 'examination',
    notes: ''
  });
  const [isSubmittingBooking, setIsSubmittingBooking] = useState<boolean>(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccessResult, setBookingSuccessResult] = useState<any | null>(null);

  // Manual Face Shape Override
  const [manualFaceShape, setManualFaceShape] = useState<FaceShapeType | null>(null);

  // Camera & Tracking State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isCameraStarting, setIsCameraStarting] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const facingModeRef = useRef<'user' | 'environment'>('user');
  useEffect(() => {
    facingModeRef.current = facingMode;
  }, [facingMode]);
  const [showDiagnosisModal, setShowDiagnosisModal] = useState<boolean>(false);
  const [isTrackingFace, setIsTrackingFace] = useState<boolean>(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(true);
  const [is3DViewerOpen, setIs3DViewerOpen] = useState<boolean>(false);
  const [isTuningPanelOpen, setIsTuningPanelOpen] = useState<boolean>(false);

  // Computer Vision Face Mesh Coordinates
  const [facePose, setFacePose] = useState<{
    detected: boolean;
    x: number;
    y: number;
    widthPx: number;
    rollDeg: number;
    pitchDeg: number;
    yawDeg: number;
    pdMm: number;
    detectedFaceShape: FaceShapeType;
    confidence: number;
  }>({
    detected: false,
    x: 50,
    y: 43,
    widthPx: 310,
    rollDeg: 0,
    pitchDeg: 0,
    yawDeg: 0,
    pdMm: 62,
    detectedFaceShape: 'round',
    confidence: 0
  });

  // Effective Face Shape (Manual override takes priority if chosen by user)
  const currentFaceShape: FaceShapeType = manualFaceShape || facePose.detectedFaceShape;

  // Real-time Match Analysis between current face and selected glasses
  const currentMatchAnalysis = useMemo(() => {
    return analyzeFaceGlassesCompatibility(currentFaceShape, selectedGlasses);
  }, [currentFaceShape, selectedGlasses]);

  // Manual Fine-Tuning Coordinates
  const [manualScale, setManualScale] = useState<number>(1.0);
  const [manualOffsetY, setManualOffsetY] = useState<number>(0);
  const [manualOffsetX, setManualOffsetX] = useState<number>(0);
  const [manualOffsetZ, setManualOffsetZ] = useState<number>(0);
  const [manualTilt, setManualTilt] = useState<number>(0);
  const [isAutoTrackingEnabled, setIsAutoTrackingEnabled] = useState<boolean>(true);

  // Snapshot Capture
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);

  // 10-Second Initial AI Face Scanning Sequence
  const [isInitialScanning, setIsInitialScanning] = useState<boolean>(true);
  const [scanElapsedMs, setScanElapsedMs] = useState<number>(0);
  const [scanJustCompleted, setScanJustCompleted] = useState<boolean>(false);
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null);
  const SCAN_TOTAL_MS = 10000; // 10 seconds

  const skipOrFinishScan = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    setScanElapsedMs(SCAN_TOTAL_MS);
    setIsInitialScanning(false);
    setScanJustCompleted(true);
    setTimeout(() => {
      setScanJustCompleted(false);
    }, 4500);
  }, [SCAN_TOTAL_MS]);

  // Trigger 10-second scan when camera is active or photo is loaded
  useEffect(() => {
    if (isCameraActive || uploadedPhotoUrl) {
      setIsInitialScanning(true);
      setScanElapsedMs(0);
      setScanJustCompleted(false);

      if (scanTimerRef.current) clearInterval(scanTimerRef.current);

      const startTime = Date.now();
      scanTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= SCAN_TOTAL_MS) {
          setScanElapsedMs(SCAN_TOTAL_MS);
          if (scanTimerRef.current) clearInterval(scanTimerRef.current);
          setIsInitialScanning(false);
          setScanJustCompleted(true);
          setTimeout(() => setScanJustCompleted(false), 4500);
        } else {
          setScanElapsedMs(elapsed);
        }
      }, 100);
    } else {
      setIsInitialScanning(false);
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    }

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [isCameraActive, uploadedPhotoUrl]);

  const scanSecondsLeft = Math.max(0, Math.ceil((SCAN_TOTAL_MS - scanElapsedMs) / 1000));
  const scanPercent = Math.min(100, Math.round((scanElapsedMs / SCAN_TOTAL_MS) * 100));

  const scanStageInfo = useMemo(() => {
    if (scanPercent < 22) {
      return {
        title: 'Khởi tạo quét sinh trắc học AI',
        subtitle: 'Đang quét 468 điểm tọa độ khuôn mặt thời gian thực...',
        icon: '🔍'
      };
    } else if (scanPercent < 45) {
      return {
        title: 'Đo lường tỷ lệ nhân trắc học',
        subtitle: 'Đo độ rộng trán, xương gò má & đường nét quai hàm...',
        icon: '📐'
      };
    } else if (scanPercent < 68) {
      return {
        title: 'Tính khoảng cách quang học (PD)',
        subtitle: 'Xác định tâm mắt & góc nghiêng 3D khuôn mặt...',
        icon: '📊'
      };
    } else if (scanPercent < 90) {
      return {
        title: 'Đối soát tỷ lệ vàng khuôn mặt',
        subtitle: 'Xác định hình dáng khuôn mặt chuẩn Y khoa...',
        icon: '💎'
      };
    } else {
      return {
        title: 'Hoàn tất phân tích!',
        subtitle: 'Đang chọn dáng kính hoàn hảo và ướm lên gương mặt...',
        icon: '✨'
      };
    }
  }, [scanPercent]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faceMeshInstanceRef = useRef<any>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const smoothedPoseRef = useRef({ x: 50, y: 43, widthPx: 310, rollDeg: 0, pitchDeg: 0, yawDeg: 0 });
  const faceLandmarks3DRef = useRef<Array<{ x: number; y: number; z: number }> | null>(null);
  const faceMeshCanvasRef = useRef<HTMLCanvasElement>(null);
  const scanPercentRef = useRef(scanPercent);
  scanPercentRef.current = scanPercent;
  const isInitialScanningRef = useRef(isInitialScanning);
  isInitialScanningRef.current = isInitialScanning;

  const manualScaleRef = useRef(manualScale);
  manualScaleRef.current = manualScale;
  const manualOffsetYRef = useRef(manualOffsetY);
  manualOffsetYRef.current = manualOffsetY;
  const manualOffsetXRef = useRef(manualOffsetX);
  manualOffsetXRef.current = manualOffsetX;
  const manualOffsetZRef = useRef(manualOffsetZ);
  manualOffsetZRef.current = manualOffsetZ;
  const manualTiltRef = useRef(manualTilt);
  manualTiltRef.current = manualTilt;

  // Key facial connection pairs for FaceMesh wireframe
  const FACEMESH_CONNECT_PAIRS: Array<[number, number]> = useMemo(() => [
    // Face Oval Contour
    [10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389], [389, 356], [356, 454], [454, 323], [323, 361], [361, 288], [288, 397], [397, 365], [365, 379], [379, 378], [378, 400], [400, 377], [377, 152],
    [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172], [172, 58], [58, 132], [132, 93], [93, 234], [234, 127], [127, 162], [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10],
    // Right Eye Contour
    [33, 7], [7, 163], [163, 144], [144, 145], [145, 153], [153, 154], [154, 155], [155, 133], [133, 173], [173, 157], [157, 158], [158, 159], [159, 160], [160, 161], [161, 246], [246, 33],
    // Left Eye Contour
    [263, 249], [249, 390], [390, 373], [373, 374], [374, 380], [380, 381], [381, 382], [382, 362], [362, 398], [398, 384], [384, 385], [385, 386], [386, 387], [387, 388], [388, 466], [466, 263],
    // Right Eyebrow
    [70, 63], [63, 105], [105, 66], [66, 107], [107, 55], [55, 65], [65, 52], [52, 53], [53, 46],
    // Left Eyebrow
    [300, 293], [293, 334], [334, 296], [296, 336], [336, 285], [285, 295], [295, 282], [282, 283], [283, 276],
    // Nose Ridge & Nose Tip
    [168, 6], [6, 197], [197, 195], [195, 5], [5, 4], [4, 1], [1, 19], [19, 94], [94, 2], [98, 97], [97, 2], [2, 326], [326, 327],
    // Outer Lips
    [61, 146], [146, 91], [91, 181], [181, 84], [84, 17], [17, 314], [314, 405], [405, 321], [321, 375], [375, 291], [291, 409], [409, 270], [270, 269], [269, 267], [267, 0], [0, 37], [37, 39], [39, 40], [40, 185], [185, 61],
    // Inner Lips
    [78, 95], [95, 88], [88, 178], [178, 87], [87, 14], [14, 317], [317, 402], [402, 318], [318, 324], [324, 308], [308, 415], [415, 310], [310, 311], [311, 312], [312, 13], [13, 82], [82, 81], [81, 80], [80, 191], [191, 78],
    // Geometric Cheek & Forehead Triangulation Cross-Links
    [10, 107], [10, 336], [10, 67], [10, 297], [107, 336], [107, 66], [336, 296], [33, 130], [263, 359],
    [130, 234], [359, 454], [1, 205], [1, 425], [205, 50], [425, 280], [50, 137], [280, 366],
    [137, 58], [366, 288], [2, 164], [164, 18], [18, 152], [58, 152], [288, 152],
    [107, 33], [336, 263], [70, 33], [300, 263], [168, 33], [168, 263], [4, 33], [4, 263],
    [234, 127], [454, 356], [127, 162], [356, 389], [162, 21], [389, 251], [21, 54], [251, 284],
    [54, 103], [284, 332], [103, 67], [332, 297], [67, 109], [297, 338], [109, 10], [338, 10],
    [107, 109], [336, 338], [66, 67], [296, 297], [105, 103], [334, 332], [63, 54], [293, 284],
    [70, 21], [300, 251], [130, 127], [359, 356], [137, 172], [366, 397], [50, 205], [280, 425],
    [205, 168], [425, 168], [205, 4], [425, 4], [50, 61], [280, 291], [147, 61], [376, 291],
    [181, 147], [405, 376], [17, 152], [314, 152], [84, 152], [61, 58], [291, 288], [137, 152], [366, 152]
  ], []);

  // Biometric Progressive Face Mesh Wireframe Canvas Loop
  useEffect(() => {
    let animId: number;

    const renderFaceMeshScanning = () => {
      const canvas = faceMeshCanvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(renderFaceMeshScanning);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(renderFaceMeshScanning);
        return;
      }

      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      if (!isInitialScanningRef.current) {
        animId = requestAnimationFrame(renderFaceMeshScanning);
        return;
      }

      const percent = scanPercentRef.current;
      if (percent <= 0) {
        animId = requestAnimationFrame(renderFaceMeshScanning);
        return;
      }

      const landmarks = faceLandmarks3DRef.current;
      const vidEl = videoRef.current;
      const vidW = (vidEl && vidEl.videoWidth) ? vidEl.videoWidth : 640;
      const vidH = (vidEl && vidEl.videoHeight) ? vidEl.videoHeight : 480;
      const vidAspect = vidW / vidH;
      const vpAspect = width / height;

      let renderedWidth = width;
      let renderedHeight = height;

      if (vpAspect < vidAspect) {
        renderedHeight = height;
        renderedWidth = height * vidAspect;
      } else {
        renderedWidth = width;
        renderedHeight = width / vidAspect;
      }

      const screenPoints: Array<{ x: number; y: number }> = [];

      if (landmarks && landmarks.length >= 468) {
        for (let i = 0; i < landmarks.length; i++) {
          const lm = landmarks[i];
          const screenX = facingMode === 'user'
            ? (width / 2 + (0.5 - lm.x) * renderedWidth)
            : (width / 2 + (lm.x - 0.5) * renderedWidth);
          const screenY = (height / 2 + (lm.y - 0.5) * renderedHeight);
          screenPoints.push({ x: screenX, y: screenY });
        }
      } else {
        // Fallback synthetic canonical points centered on facePose
        const pose = smoothedPoseRef.current;
        const centerX = (pose.x / 100) * width;
        const centerY = (pose.y / 100) * height;
        const w = pose.widthPx || 280;
        const h = w * 1.3;
        const rollRad = (pose.rollDeg * Math.PI) / 180;

        for (let r = 0; r < 8; r++) {
          const radiusX = (w * 0.48) * (r + 1) / 8;
          const radiusY = (h * 0.48) * (r + 1) / 8;
          const count = 12 + r * 6;
          for (let c = 0; c < count; c++) {
            const angle = (c / count) * Math.PI * 2;
            const rawX = Math.cos(angle) * radiusX;
            const rawY = Math.sin(angle) * radiusY;
            const rotX = rawX * Math.cos(rollRad) - rawY * Math.sin(rollRad);
            const rotY = rawX * Math.sin(rollRad) + rawY * Math.cos(rollRad);
            screenPoints.push({ x: centerX + rotX, y: centerY + rotY });
          }
        }
      }

      const totalPts = screenPoints.length;
      const maxIndex = Math.min(totalPts, Math.floor((percent / 100) * totalPts * 1.08));

      // Calculate vertical laser scan line position for laser-ping effect
      const now = Date.now();
      const laserCycle = (now % 2800) / 2800;
      const laserYPercent = 0.15 + 0.65 * (Math.sin(laserCycle * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
      const laserScreenY = laserYPercent * height;

      // 1. Draw Connecting Lines / Triangulation Web
      ctx.lineWidth = 1.1;
      const baseAlpha = Math.min(0.65, (percent / 75) * 0.65);

      if (landmarks && landmarks.length >= 468) {
        for (let i = 0; i < FACEMESH_CONNECT_PAIRS.length; i++) {
          const [idxA, idxB] = FACEMESH_CONNECT_PAIRS[i];
          if (idxA < maxIndex && idxB < maxIndex && screenPoints[idxA] && screenPoints[idxB]) {
            const ptA = screenPoints[idxA];
            const ptB = screenPoints[idxB];
            const dist = Math.hypot(ptA.x - ptB.x, ptA.y - ptB.y);
            if (dist < 140) {
              const avgY = (ptA.y + ptB.y) / 2;
              const nearLaser = Math.abs(avgY - laserScreenY) < 35;
              ctx.beginPath();
              ctx.moveTo(ptA.x, ptA.y);
              ctx.lineTo(ptB.x, ptB.y);
              ctx.strokeStyle = nearLaser
                ? 'rgba(253, 224, 71, 0.75)'
                : `rgba(16, 185, 129, ${baseAlpha})`;
              ctx.stroke();
            }
          }
        }
      } else {
        for (let i = 0; i < maxIndex - 1; i++) {
          const ptA = screenPoints[i];
          const ptB = screenPoints[i + 1];
          const dist = Math.hypot(ptA.x - ptB.x, ptA.y - ptB.y);
          if (dist < 60) {
            ctx.beginPath();
            ctx.moveTo(ptA.x, ptA.y);
            ctx.lineTo(ptB.x, ptB.y);
            ctx.strokeStyle = `rgba(16, 185, 129, ${baseAlpha * 0.7})`;
            ctx.stroke();
          }
        }
      }

      // 2. Draw Points with Glowing Nodes
      for (let i = 0; i < maxIndex; i++) {
        const pt = screenPoints[i];
        if (!pt) continue;

        const nearLaser = Math.abs(pt.y - laserScreenY) < 25;
        ctx.beginPath();

        if (nearLaser) {
          ctx.arc(pt.x, pt.y, 2.8, 0, Math.PI * 2);
          ctx.fillStyle = '#FDE047';
          ctx.shadowColor = '#FDE047';
          ctx.shadowBlur = 8;
        } else {
          ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = '#34D399';
          ctx.shadowColor = '#10B981';
          ctx.shadowBlur = 3;
        }
        ctx.fill();
      }

      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(renderFaceMeshScanning);
    };

    animId = requestAnimationFrame(renderFaceMeshScanning);
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [facingMode, FACEMESH_CONNECT_PAIRS]);

  // ==========================================
  // 3. COMPUTER VISION & MEDIAPIPE FACE MESH
  // ==========================================
  const loadMediaPipeScript = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if ((window as any).FaceMesh) {
        resolve(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        resolve(true);
      };
      script.onerror = () => {
        console.warn('MediaPipe FaceMesh script load fallback');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }, []);

  // Live Anthropometric Telemetry Metrics
  const [faceMetrics, setFaceMetrics] = useState<{
    ratio: number;
    jawRatio: number;
    foreheadRatio: number;
    chinAngle: number;
  }>({
    ratio: 1.35,
    jawRatio: 0.78,
    foreheadRatio: 0.85,
    chinAngle: 72
  });

  const processLandmarks = useCallback((landmarks: Array<{ x: number; y: number; z: number }>) => {
    if (!landmarks || landmarks.length < 468) return;
    faceLandmarks3DRef.current = landmarks;

    const noseBridge = landmarks[168] || landmarks[6];
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];
    const leftTemple = landmarks[234];
    const rightTemple = landmarks[454];
    const forehead = landmarks[10];
    const chin = landmarks[152];
    const jawLeft = landmarks[58] || landmarks[172];
    const jawRight = landmarks[288] || landmarks[397];
    const foreheadLeft = landmarks[103] || landmarks[67];
    const foreheadRight = landmarks[332] || landmarks[297];

    if (!noseBridge || !leftEyeOuter || !rightEyeOuter || !leftTemple || !rightTemple) return;

    // Viewport and true rendered video dimensions under CSS object-fit: cover
    const viewportWidth = viewportRef.current?.clientWidth || window.innerWidth;
    const viewportHeight = viewportRef.current?.clientHeight || window.innerHeight;

    const vidEl = videoRef.current;
    const vidW = (vidEl && vidEl.videoWidth) ? vidEl.videoWidth : 640;
    const vidH = (vidEl && vidEl.videoHeight) ? vidEl.videoHeight : 480;
    const vidAspect = vidW / vidH;
    const vpAspect = viewportWidth / viewportHeight;

    let renderedWidth = viewportWidth;
    let renderedHeight = viewportHeight;

    if (vpAspect < vidAspect) {
      // Mobile portrait / Height-constrained
      renderedHeight = viewportHeight;
      renderedWidth = viewportHeight * vidAspect;
    } else {
      // Desktop / Width-constrained
      renderedWidth = viewportWidth;
      renderedHeight = viewportWidth / vidAspect;
    }

    // 1. Calculate Center Position in screen percentage [0, 100]
    const screenX = facingMode === 'user'
      ? (viewportWidth / 2 + (0.5 - noseBridge.x) * renderedWidth)
      : (viewportWidth / 2 + (noseBridge.x - 0.5) * renderedWidth);
    const screenY = (viewportHeight / 2 + (noseBridge.y - 0.5) * renderedHeight);

    const rawX = (screenX / viewportWidth) * 100;
    const rawY = (screenY / viewportHeight) * 100;

    // 2. Calculate Width in Pixels
    const templeDistX = (rightTemple.x - leftTemple.x) * renderedWidth;
    const templeDistY = (rightTemple.y - leftTemple.y) * renderedHeight;
    const faceWidthPx = Math.sqrt(templeDistX * templeDistX + templeDistY * templeDistY);
    const targetWidthPx = Math.max(140, Math.min(600, faceWidthPx * 0.94));

    // 3. Calculate 3D Angles (Roll, Yaw, Pitch)
    // 3a. Roll (tilt head left/right)
    const dX = (rightEyeOuter.x - leftEyeOuter.x) * renderedWidth;
    const dY = (rightEyeOuter.y - leftEyeOuter.y) * renderedHeight;
    let rollDeg = Math.atan2(dY, dX) * (180 / Math.PI);
    if (facingMode === 'user') {
      rollDeg = -rollDeg;
    }

    // 3b. Yaw (turn head left/right - tracking ears/temple depth)
    const leftTempleDist = Math.abs(noseBridge.x - leftTemple.x);
    const rightTempleDist = Math.abs(rightTemple.x - noseBridge.x);
    const totalTempleSpan = leftTempleDist + rightTempleDist || 0.001;
    const yawRatio = (rightTempleDist - leftTempleDist) / totalTempleSpan;
    let yawDeg = Math.asin(Math.max(-0.85, Math.min(0.85, yawRatio * 1.4))) * (180 / Math.PI);
    if (facingMode === 'user') {
      yawDeg = -yawDeg;
    }

    // 3c. Pitch (tilt head up/down)
    const topDist = Math.abs(noseBridge.y - (forehead?.y ?? 0));
    const botDist = Math.abs((chin?.y ?? 1) - noseBridge.y);
    const faceHeightSpan = topDist + botDist || 0.001;
    const pitchRatio = ((topDist / faceHeightSpan) - 0.44) * 2.8;
    const pitchDeg = Math.asin(Math.max(-0.7, Math.min(0.7, pitchRatio))) * (180 / Math.PI);

    // 4. 3D Perspective Pitch Compensation
    const pitchCorrectionFactor = 1 / Math.max(0.7, Math.cos((pitchDeg * Math.PI) / 180));

    // 5. Calculate Scientific Facial Proportions (Farkas Criteria)
    let detectedShape: FaceShapeType = 'oval';
    let rawRatio = 1.35;
    let rawJawRatio = 0.78;
    let rawForeheadRatio = 0.85;

    if (forehead && chin && jawLeft && jawRight && leftTemple && rightTemple) {
      const rawHeight = Math.abs(chin.y - forehead.y) * pitchCorrectionFactor;
      const faceWidth = Math.abs(rightTemple.x - leftTemple.x) || 0.01;
      const jawWidth = Math.abs(jawRight.x - jawLeft.x) || 0.01;
      const foreheadWidth = (foreheadLeft && foreheadRight) ? Math.abs(foreheadRight.x - foreheadLeft.x) : faceWidth * 0.85;

      rawRatio = rawHeight / faceWidth;
      rawJawRatio = jawWidth / faceWidth;
      rawForeheadRatio = foreheadWidth / faceWidth;

      // Classification Tree:
      if (rawRatio > 1.38) {
        detectedShape = 'oval';
      } else if (rawRatio < 1.22) {
        if (rawJawRatio > 0.84) {
          detectedShape = 'square';
        } else {
          detectedShape = 'round';
        }
      } else {
        if (rawJawRatio > 0.85 && rawForeheadRatio > 0.82) {
          detectedShape = 'square';
        } else if (rawJawRatio < 0.72 && rawForeheadRatio > 0.84) {
          detectedShape = 'heart';
        } else if (rawForeheadRatio < 0.78 && rawJawRatio < 0.78) {
          detectedShape = 'diamond';
        } else {
          detectedShape = 'oval';
        }
      }

      setFaceMetrics({
        ratio: Math.round(rawRatio * 100) / 100,
        jawRatio: Math.round(rawJawRatio * 100),
        foreheadRatio: Math.round(rawForeheadRatio * 100),
        chinAngle: Math.round(70 + (1 - rawJawRatio) * 30)
      });
    }

    // 6. EMA Smoothing for all 3D pose coordinates
    const alpha = 0.42;
    const smoothed = smoothedPoseRef.current;
    smoothed.x = smoothed.x * (1 - alpha) + rawX * alpha;
    smoothed.y = smoothed.y * (1 - alpha) + rawY * alpha;
    smoothed.widthPx = smoothed.widthPx * (1 - alpha) + targetWidthPx * alpha;
    smoothed.rollDeg = smoothed.rollDeg * (1 - alpha) + rollDeg * alpha;
    smoothed.pitchDeg = smoothed.pitchDeg * (1 - alpha) + pitchDeg * alpha;
    smoothed.yawDeg = smoothed.yawDeg * (1 - alpha) + yawDeg * alpha;

    setFacePose({
      detected: true,
      x: smoothed.x,
      y: smoothed.y,
      widthPx: smoothed.widthPx,
      rollDeg: smoothed.rollDeg,
      pitchDeg: smoothed.pitchDeg,
      yawDeg: smoothed.yawDeg,
      pdMm: 62 + Math.round((noseBridge.z || 0) * 10),
      detectedFaceShape: detectedShape,
      confidence: 0.98
    });
    setIsTrackingFace(true);
  }, [facingMode]);

  // Real-time CV Detection Loop
  const startComputerVisionTracking = useCallback(async () => {
    await loadMediaPipeScript();

    if (!(window as any).FaceMesh) {
      console.warn('FaceMesh global not available, using fallback');
      return;
    }

    try {
      if (!faceMeshInstanceRef.current) {
        const faceMesh = new (window as any).FaceMesh({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults((results: any) => {
          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            processLandmarks(results.multiFaceLandmarks[0]);
          } else {
            setIsTrackingFace(false);
          }
        });

        faceMeshInstanceRef.current = faceMesh;
      }

      const runTrackingLoop = async () => {
        if (videoRef.current && videoRef.current.readyState >= 2 && faceMeshInstanceRef.current) {
          try {
            await faceMeshInstanceRef.current.send({ image: videoRef.current });
          } catch (e) {
            // Frame skip
          }
        }
        animFrameIdRef.current = requestAnimationFrame(runTrackingLoop);
      };

      runTrackingLoop();
    } catch (err) {
      console.warn('CV FaceMesh loop init error:', err);
    }
  }, [loadMediaPipeScript, processLandmarks]);

  // Camera Controls
  const startCamera = useCallback(async (mode: 'user' | 'environment' = facingMode) => {
    setIsCameraStarting(true);
    setCameraError(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ WebRTC Camera. Vui lòng thử trên Chrome/Safari.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsCameraActive(true);
      setUploadedPhotoUrl(null);
      startComputerVisionTracking();
    } catch (err: any) {
      console.warn('Camera error:', err);
      let msg = 'Không thể mở Camera. Vui lòng cấp quyền truy cập Camera trên trình duyệt.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Bạn đã chặn quyền Camera. Hãy bấm vào biểu tượng ổ khóa 🔒 trên thanh địa chỉ để cấp quyền lại.';
      }
      setCameraError(msg);
      setIsCameraActive(false);
    } finally {
      setIsCameraStarting(false);
    }
  }, [facingMode, startComputerVisionTracking]);

  const stopCamera = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsTrackingFace(false);
  }, []);

  const flipCamera = useCallback(() => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    if (isCameraActive) {
      startCamera(nextMode);
    }
  }, [facingMode, isCameraActive, startCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      stopCamera();
      const reader = new FileReader();
      reader.onload = (ev) => {
        setUploadedPhotoUrl(ev.target?.result as string);
        setCameraError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  // High-Resolution Composited Snapshot Capture (Synchronizes Camera Video + 3D Glasses Layer + Watermark)
  const createCompositedSnapshot = async (): Promise<string | null> => {
    try {
      const vp = viewportRef.current;
      const vpRect = vp ? vp.getBoundingClientRect() : null;
      const width = vpRect && vpRect.width > 0 ? Math.round(vpRect.width) : 1080;
      const height = vpRect && vpRect.height > 0 ? Math.round(vpRect.height) : 1350;

      const canvas = document.createElement('canvas');
      const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.scale(dpr, dpr);

      // 1. Draw video background with accurate object-fit: cover
      if (isCameraActive && videoRef.current && videoRef.current.videoWidth) {
        const video = videoRef.current;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const videoRatio = vw / vh;
        const canvasRatio = width / height;

        let sx = 0, sy = 0, sWidth = vw, sHeight = vh;
        if (canvasRatio > videoRatio) {
          sHeight = vw / canvasRatio;
          sy = (vh - sHeight) / 2;
        } else {
          sWidth = vh * canvasRatio;
          sx = (vw - sWidth) / 2;
        }

        ctx.save();
        if (facingMode === 'user') {
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);
        ctx.restore();
      } else if (uploadedPhotoUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve) => {
          img.onload = () => {
            ctx.drawImage(img, 0, 0, width, height);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = uploadedPhotoUrl;
        });
      } else {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Draw Three.js WebGL 3D Glasses Layer
      if ((isCameraActive || uploadedPhotoUrl) && selectedGlasses?.model3dUrl && threeCanvasRef.current) {
        if (threeContextRef.current?.renderer && threeContextRef.current?.scene && threeContextRef.current?.camera) {
          threeContextRef.current.renderer.render(
            threeContextRef.current.scene,
            threeContextRef.current.camera
          );
        }
        ctx.drawImage(threeCanvasRef.current, 0, 0, width, height);
      } else if ((isCameraActive || uploadedPhotoUrl) && selectedGlasses && !selectedGlasses.model3dUrl) {
        // Draw SVG 2D Glasses Layer
        const svgElement = document.querySelector('.ar-glasses-interactive-layer svg');
        if (svgElement) {
          const svgString = new XMLSerializer().serializeToString(svgElement);
          const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
          const blobUrl = URL.createObjectURL(svgBlob);
          const svgImg = new Image();
          await new Promise<void>((resolve) => {
            svgImg.onload = () => {
              const containerRect = viewportRef.current?.getBoundingClientRect();
              const layerRect = document.querySelector('.ar-glasses-interactive-layer')?.getBoundingClientRect();
              if (containerRect && layerRect) {
                const gx = layerRect.left - containerRect.left;
                const gy = layerRect.top - containerRect.top;
                const gw = layerRect.width;
                const gh = layerRect.height;
                ctx.drawImage(svgImg, gx, gy, gw, gh);
              }
              URL.revokeObjectURL(blobUrl);
              resolve();
            };
            svgImg.onerror = () => {
              URL.revokeObjectURL(blobUrl);
              resolve();
            };
            svgImg.src = blobUrl;
          });
        }
      }

      // 3. Watermark Info Banner at Bottom
      const bannerHeight = Math.max(88, Math.round(height * 0.12));
      const bannerY = height - bannerHeight;
      ctx.fillStyle = 'rgba(11, 15, 25, 0.9)';
      ctx.fillRect(0, bannerY, width, bannerHeight);

      // Gold top border line
      ctx.fillStyle = '#D4AF37';
      ctx.fillRect(0, bannerY, width, 2);

      const padX = Math.round(Math.max(20, width * 0.04));
      ctx.font = `bold ${Math.round(bannerHeight * 0.22)}px Inter, sans-serif`;
      ctx.fillStyle = '#E8C97A';
      ctx.fillText('LÊ QUỲNH OPTIC • AI AR VIRTUAL FITTING', padX, bannerY + bannerHeight * 0.34);

      ctx.font = `600 ${Math.round(bannerHeight * 0.17)}px Inter, sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      if (selectedGlasses) {
        ctx.fillText(`Mẫu kính: ${selectedGlasses.brand} ${selectedGlasses.name} • ${selectedGlasses.price} (${currentMatchAnalysis.badgeLabel})`, padX, bannerY + bannerHeight * 0.62);
      }

      ctx.font = `500 ${Math.round(bannerHeight * 0.14)}px Inter, sans-serif`;
      ctx.fillStyle = '#94A3B8';
      ctx.fillText('📍 380B Nguyễn Doãn Chấp, TP. Thanh Hóa • Hotline: 0989.435.160', padX, bannerY + bannerHeight * 0.88);

      return canvas.toDataURL('image/jpeg', 0.95);
    } catch (err) {
      console.error('Composited snapshot error:', err);
      return null;
    }
  };

  // Snapshot Capture Trigger
  const takeSnapshot = async () => {
    setIsCapturing(true);
    try {
      const dataUrl = await createCompositedSnapshot();
      if (dataUrl) {
        setCapturedPhoto(dataUrl);
      }
    } catch (err) {
      console.error('Snapshot capture error:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  // Initialize Three.js WebGL Engine for 3D GLB Model rendering with 3D Perspective & Depth
  useEffect(() => {
    if (!threeCanvasRef.current || !selectedGlasses?.model3dUrl) {
      if (threeContextRef.current?.renderer) {
        threeContextRef.current.renderer.dispose();
      }
      threeContextRef.current = null;
      setModelLoadingProgress(null);
      return;
    }
    let isCancelled = false;
    let animFrameId: number;

    async function initThree() {
      try {
        console.log('[3D AR] Initializing 3D Perspective AR engine for:', selectedGlasses?.model3dUrl);
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

        if (isCancelled || !threeCanvasRef.current) return;

        const canvas = threeCanvasRef.current;
        const viewport = viewportRef.current;
        const width = viewport?.clientWidth || window.innerWidth;
        const height = viewport?.clientHeight || window.innerHeight;

        canvas.width = width;
        canvas.height = height;

        const scene = new THREE.Scene();

        // 45 degree Perspective Camera with 1:1 pixel mapping at Z=0
        const fov = 45;
        const aspect = width / height;
        const camera = new THREE.PerspectiveCamera(fov, aspect, 1, 5000);
        const fovRad = (fov * Math.PI) / 180;
        const cameraZ = (height / 2) / Math.tan(fovRad / 2);
        camera.position.set(0, 0, cameraZ);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);

        // Realistic Studio Lighting for Optical Frames & Lenses
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.2);
        scene.add(ambientLight);

        const frontLight = new THREE.DirectionalLight(0xffffff, 1.8);
        frontLight.position.set(0, 200, 1000);
        scene.add(frontLight);

        const leftLight = new THREE.DirectionalLight(0xffffff, 1.0);
        leftLight.position.set(-500, 300, 400);
        scene.add(leftLight);

        const rightLight = new THREE.DirectionalLight(0xffffff, 1.0);
        rightLight.position.set(500, 300, 400);
        scene.add(rightLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.7);
        backLight.position.set(0, -200, -500);
        scene.add(backLight);

        const pivotGroup = new THREE.Group();
        scene.add(pivotGroup);

        // ===== Continuous Anthropometric Head Occluder System (Full 6-DoF Physics) =====
        // An invisible solid 3D skull/cheek/temple geometry is ALWAYS active in the scene.
        // It writes depth to the GPU Z-Buffer (colorWrite: false, depthWrite: true, depthTest: true).
        // • Front surface sits at Z = -0.045 (with nasal bridge dip to Z = -0.065), so
        //   the glasses front frame (at Z = 0), nose pads, and lenses are ALWAYS in front of the face and 100% visible.
        // • The cheek and skull volume (X = +/-0.39, Z extending from -0.045 to -1.0) naturally occludes
        //   any temple arms that pass through or behind the head when looking straight or turning.
        // • When the head rotates in ANY continuous angle (-90° to +90°, pitch up/down, roll),
        //   the GPU depth buffer automatically clips the far-side temple smoothly without discrete thresholds.

        const occluderMat = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: true,
          side: THREE.DoubleSide,
        });

        function createAnatomicalHeadOccluder() {
          const geo = new THREE.SphereGeometry(0.50, 48, 36);
          // Scale to anthropometric human skull proportions
          geo.scale(0.78, 1.18, 1.10);

          const pos = geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            let z = pos.getZ(i);

            // Shape front face: When translated by -0.48, local Z is (z - 0.48).
            // We want the front surface (local Z > -0.045) to stay at -0.045 behind the glasses frame,
            // with a slight eye socket / nose bridge dip at -0.065 in the center (|x| < 0.32).
            const worldZ = z - 0.48;
            if (worldZ > -0.045) {
              const targetZ = Math.abs(x) < 0.32 && y > -0.22 && y < 0.22 ? -0.065 : -0.045;
              z = targetZ + 0.48;
              pos.setZ(i, z);
            }
          }
          pos.needsUpdate = true;
          geo.computeVertexNormals();

          // Position skull center behind nose bridge
          geo.translate(0, -0.08, -0.48);
          return geo;
        }

        const headOccGeo = createAnatomicalHeadOccluder();
        const headOccluder = new THREE.Mesh(headOccGeo, occluderMat);
        headOccluder.renderOrder = 0;
        headOccluder.visible = true; // ALWAYS ACTIVE for continuous 6-DoF depth occlusion
        pivotGroup.add(headOccluder);

        threeContextRef.current = {
          renderer,
          scene,
          camera,
          pivotGroup,
          modelBaseWidth: 1,
          isModelReady: false,
          headOccluder,
        };

        const loader = new GLTFLoader();
        setModelLoadingProgress(10);

        loader.load(
          selectedGlasses!.model3dUrl!,
          (gltf: any) => {
            if (isCancelled) return;
            console.log('[3D AR] Model loaded successfully, configuring 3D geometry...');
            setModelLoadingProgress(null);

            const model = gltf.scene;

            // Ensure glasses meshes render after occluder with proper depth testing
            model.traverse((child: any) => {
              if (child.isMesh) {
                child.renderOrder = 2; // Render after occluder
                if (child.material) {
                  child.material.depthTest = true;
                  child.material.depthWrite = true;
                }
              }
            });

            // Auto-center and configure realistic 3D pivot on nose bridge
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Center horizontally on bridge (X = -center.x)
            // Center vertically on eyes/bridge (Y = -center.y)
            // Align the FRONT of the frame at Z = 0 so the temples extend backwards along -Z (into head towards ears!)
            const frontZ = box.max.z;
            model.position.set(-center.x, -center.y, -frontZ);

            // Scale head occluder geometry to match the model's base width
            const baseWidth = Math.max(0.01, size.x);
            headOccluder.scale.set(baseWidth, baseWidth, baseWidth);

            pivotGroup.add(model);

            threeContextRef.current!.modelBaseWidth = baseWidth;
            threeContextRef.current!.isModelReady = true;

            console.log('[3D AR] Configured 3D Pivot & Continuous Occluder:', {
              size,
              baseWidth,
              frontZ
            });
          },
          (progress: any) => {
            if (progress.total && progress.total > 0) {
              const pct = Math.min(99, Math.round((progress.loaded / progress.total) * 100));
              setModelLoadingProgress(pct);
            } else if (progress.loaded) {
              setModelLoadingProgress(60);
            }
          },
          (err: any) => {
            console.error('[3D AR] Failed to load 3D GLB model:', err);
            setModelLoadingProgress(null);
          }
        );

        // 60FPS Continuous Render Loop with 3D Face Orthonormal Basis Tracking
        function renderLoop() {
          if (isCancelled) return;

          if (threeContextRef.current?.isModelReady && threeContextRef.current.pivotGroup) {
            const { renderer, scene, camera, pivotGroup, modelBaseWidth } = threeContextRef.current;
            const pose = smoothedPoseRef.current;
            const landmarks = faceLandmarks3DRef.current;

            const vpW = viewportRef.current?.clientWidth || window.innerWidth;
            const vpH = viewportRef.current?.clientHeight || window.innerHeight;

            // Handle dynamic viewport resize
            const curAspect = vpW / vpH;
            if (Math.abs(camera.aspect - curAspect) > 0.01) {
              camera.aspect = curAspect;
              const camZ = (vpH / 2) / Math.tan((45 * Math.PI / 180) / 2);
              camera.position.set(0, 0, camZ);
              camera.updateProjectionMatrix();
              renderer.setSize(vpW, vpH);
            }

            // Calculate true rendered video dimensions under CSS object-fit: cover
            const vidEl = videoRef.current;
            const vidW = (vidEl && vidEl.videoWidth) ? vidEl.videoWidth : 640;
            const vidH = (vidEl && vidEl.videoHeight) ? vidEl.videoHeight : 480;
            const vidAspect = vidW / vidH;
            const vpAspect = vpW / vpH;

            let renderedWidth = vpW;
            let renderedHeight = vpH;

            if (vpAspect < vidAspect) {
              // Mobile portrait / Height-constrained
              renderedHeight = vpH;
              renderedWidth = vpH * vidAspect;
            } else {
              // Desktop landscape / Width-constrained
              renderedWidth = vpW;
              renderedHeight = vpW / vidAspect;
            }

            if (landmarks && landmarks.length >= 468) {
              // Convert landmark to Three.js world space coordinates (Center at (0, 0, 0))
              const to3D = (pt: { x: number; y: number; z: number }) => {
                const normX = facingModeRef.current === 'user' ? (0.5 - pt.x) : (pt.x - 0.5);
                const x = normX * renderedWidth;
                const y = (0.5 - pt.y) * renderedHeight;
                const z = -(pt.z || 0) * renderedWidth * 1.5;
                return new THREE.Vector3(x, y, z);
              };

              // Key anatomical 3D points
              const pLeftOuter = to3D(facingModeRef.current === 'user' ? landmarks[263] : landmarks[33]);
              const pRightOuter = to3D(facingModeRef.current === 'user' ? landmarks[33] : landmarks[263]);
              const pLeftInner = to3D(facingModeRef.current === 'user' ? landmarks[362] : landmarks[133]);
              const pRightInner = to3D(facingModeRef.current === 'user' ? landmarks[133] : landmarks[362]);
              const pEyeCenter = new THREE.Vector3().addVectors(pLeftInner, pRightInner).multiplyScalar(0.5);

              // Rigid Upper Facial Skull & Nasal Midline (Immune to mouth/jaw motion)
              const pNoseRoot = to3D(landmarks[168]); // Sellion / Nasion (gốc sống mũi)
              const pNoseMid = to3D(landmarks[6]);    // Mid nasal bridge (Rhinion)
              const pForehead = to3D(landmarks[10]);  // Trán giữa
              const pSubnasale = to3D(landmarks[2] || landmarks[164] || landmarks[1]); // Chân mũi dưới

              // 1. Orthonormal 3D Face Basis Vectors
              // Vector X: Along eye line (Left to Right)
              const vecX = new THREE.Vector3().subVectors(pRightOuter, pLeftOuter).normalize();

              // Vector Y temp: Rigid upper facial skull midline (Subnasale up to Forehead)
              const vecYMid = new THREE.Vector3().subVectors(pForehead, pSubnasale).normalize();

              // Vector Z: Face Normal (Orthogonal outward from face towards camera)
              const vecZ = new THREE.Vector3().crossVectors(vecX, vecYMid).normalize();
              if (vecZ.z < 0) vecZ.negate(); // Always points outward toward camera

              // True orthogonal Up Vector Y
              const vecY = new THREE.Vector3().crossVectors(vecZ, vecX).normalize();

              // 2. Exact 3D Rotation Matrix & Quaternion
              const basisMatrix = new THREE.Matrix4().makeBasis(vecX, vecY, vecZ);
              const targetQ = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

              // Apply user-controlled manual tilt adjustment if modified
              if (manualTiltRef.current !== 0) {
                const userTiltQ = new THREE.Quaternion().setFromAxisAngle(vecX, (manualTiltRef.current * Math.PI) / 180);
                targetQ.premultiply(userTiltQ);
              }

              // Smooth 3D Quaternion Slerp (zero gimbal lock, exact head orientation across all angles)
              pivotGroup.quaternion.slerp(targetQ, 0.48);

              // 3. Smooth Position Tracking with Forward Vertex Distance & Micro-Offset
              const eyeSpan = pLeftOuter.distanceTo(pRightOuter);
              const targetBridgePos = new THREE.Vector3()
                .addScaledVector(pNoseMid, 0.45)
                .addScaledVector(pNoseRoot, 0.35)
                .addScaledVector(pEyeCenter, 0.20);

              // Forward offset along normal vector vecZ (~8% of eye span = ~11-13mm in front of eye plane)
              const forwardZ = (eyeSpan * 0.08) + (manualOffsetZRef.current * 0.005) * vpW;
              const forwardVec = vecZ.clone().multiplyScalar(forwardZ);

              const targetWorldPos = new THREE.Vector3(
                targetBridgePos.x + forwardVec.x + (manualOffsetXRef.current * 0.005) * vpW,
                targetBridgePos.y + forwardVec.y - (manualOffsetYRef.current * 0.005) * vpH,
                targetBridgePos.z + forwardVec.z
              );
              pivotGroup.position.lerp(targetWorldPos, 0.48);

              // 4. Realistic Scale with 3D Eye Span & Smooth Lerp (1.46x ratio)
              const targetWidthPx = Math.max(120, eyeSpan * 1.46) * manualScaleRef.current;
              const targetScale = targetWidthPx / (modelBaseWidth || 1);
              const curScale = pivotGroup.scale.x || targetScale;
              const nextScale = THREE.MathUtils.lerp(curScale, targetScale, 0.40);
              pivotGroup.scale.set(nextScale, nextScale, nextScale);
            } else {
              // Fallback if landmarks array is momentarily empty
              const normX = facingModeRef.current === 'user' ? (50 - pose.x) / 100 : (pose.x - 50) / 100;
              const normY = (50 - pose.y) / 100;
              const pixelX = normX * renderedWidth;
              const pixelY = normY * renderedHeight + (manualOffsetYRef.current / 100) * vpH;
              pivotGroup.position.set(pixelX, pixelY, 0);

              const targetWidthPx = pose.widthPx * 0.88 * manualScaleRef.current;
              const scale = targetWidthPx / (modelBaseWidth || 1);
              pivotGroup.scale.set(scale, scale, scale);

              const pitchRad = (pose.pitchDeg * Math.PI) / 180;
              const yawRad = (pose.yawDeg * Math.PI) / 180;
              const rollRad = (pose.rollDeg * Math.PI) / 180;
              pivotGroup.rotation.order = 'YXZ';
              pivotGroup.rotation.set(-pitchRad, yawRad, -rollRad);
            }

            renderer.render(scene, camera);
          }

          animFrameId = requestAnimationFrame(renderLoop);
        }

        renderLoop();
      } catch (e) {
        console.error('[3D AR] Three.js initialization error:', e);
      }
    }

    initThree();

    return () => {
      isCancelled = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (threeContextRef.current?.renderer) {
        threeContextRef.current.renderer.dispose();
      }
      threeContextRef.current = null;
    };
  }, [selectedGlasses?.model3dUrl, isCameraActive, uploadedPhotoUrl]);

  // Dynamic Product Counts per Category & Shape
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: glassesCatalog.length,
      titan: 0,
      acetate: 0,
      square: 0,
      round: 0,
      cateye: 0,
      aviator: 0,
      rimless: 0,
      geometric: 0,
    };

    glassesCatalog.forEach((item) => {
      // Materials
      if (item.categoryKey === 'titan' || item.material?.toLowerCase().includes('titan') || item.category?.toLowerCase().includes('titan')) {
        counts.titan++;
      }
      if (item.categoryKey === 'acetate' || item.material?.toLowerCase().includes('acetate') || item.material?.toLowerCase().includes('nhựa') || item.category?.toLowerCase().includes('acetate')) {
        counts.acetate++;
      }
      // Shapes
      if (item.shapeLabel === 'Chưa xác định') return;
      if (item.shape === 'square' || item.categoryKey === 'square') counts.square++;
      if (item.shape === 'round' || item.categoryKey === 'round') counts.round++;
      if (item.shape === 'cateye' || item.categoryKey === 'cateye') counts.cateye++;
      if (item.shape === 'aviator' || item.categoryKey === 'aviator') counts.aviator++;
      if (item.shape === 'rimless' || item.categoryKey === 'rimless') counts.rimless++;
      if (item.shape === 'geometric' || item.categoryKey === 'geometric') counts.geometric++;
    });

    return counts;
  }, [glassesCatalog]);

  const matchingFaceCount = useMemo(() => {
    return glassesCatalog.filter(item => item.bestForFaces.includes(currentFaceShape)).length;
  }, [glassesCatalog, currentFaceShape]);

  // If active category has 0 items, auto reset to 'all'
  useEffect(() => {
    if (activeCategory !== 'all' && (categoryCounts[activeCategory] ?? 0) === 0) {
      setActiveCategory('all');
    }
  }, [categoryCounts, activeCategory]);

  // Filter Catalog from Dynamic Database Products
  const filteredCatalog = glassesCatalog.filter((item) => {
    let matchCategory = activeCategory === 'all';
    if (!matchCategory) {
      if (activeCategory === 'titan') {
        matchCategory = item.categoryKey === 'titan' ||
          item.material.toLowerCase().includes('titan') ||
          item.category.toLowerCase().includes('titan');
      } else if (activeCategory === 'acetate') {
        matchCategory = item.categoryKey === 'acetate' ||
          item.material.toLowerCase().includes('acetate') ||
          item.material.toLowerCase().includes('nhựa') ||
          item.category.toLowerCase().includes('acetate');
      } else if (item.shapeLabel === 'Chưa xác định') {
        matchCategory = false;
      } else if (activeCategory === 'rimless') {
        matchCategory = item.shape === 'rimless' || item.categoryKey === 'rimless';
      } else if (activeCategory === 'cateye') {
        matchCategory = item.shape === 'cateye' || item.categoryKey === 'cateye';
      } else if (activeCategory === 'round') {
        matchCategory = item.shape === 'round' || item.categoryKey === 'round';
      } else if (activeCategory === 'square') {
        matchCategory = item.shape === 'square' || item.categoryKey === 'square';
      } else if (activeCategory === 'aviator') {
        matchCategory = item.shape === 'aviator' || item.categoryKey === 'aviator';
      } else if (activeCategory === 'geometric') {
        matchCategory = item.shape === 'geometric' || item.categoryKey === 'geometric';
      } else {
        matchCategory = item.categoryKey === activeCategory || item.shape === activeCategory;
      }
    }
    const matchFace = !filterByMyFace || item.bestForFaces.includes(currentFaceShape);
    return matchCategory && matchFace;
  });

  // Render SVG Glasses
  const renderRealisticGlassesSVG = (item: RealGlassesItem, colorIdx: number) => {
    const color = item.colors[colorIdx] || item.colors[0] || {
      name: 'Tiêu chuẩn',
      hex: '#18181B',
      frameColor: '#18181B',
      templeColor: '#C89D65',
      lensGradient: 'rgba(56, 189, 248, 0.15)'
    };
    const shape = normalizeGlassesShape(item.shape);
    const gradId = `ar-grad-${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}-${colorIdx}`;
    const woodId = `ar-wood-${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}-${colorIdx}`;
    const lensId = `ar-lens-${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}-${colorIdx}`;

    const isWood = color.templeColor === '#C89D65' ||
      item.name.toLowerCase().includes('gỗ') ||
      item.material.toLowerCase().includes('gỗ');

    return (
      <svg
        viewBox="-50 0 340 100"
        className="ar-optical-glasses-svg"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'visible',
          filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5)) drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
        }}
      >
        <defs>
          {/* Frame Rim Gradient */}
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color.frameColor || '#18181B'} />
            <stop offset="35%" stopColor={color.frameColor === '#18181B' ? '#3F3F46' : '#FFFFFF'} stopOpacity={color.frameColor === '#18181B' ? 0.7 : 0.45} />
            <stop offset="70%" stopColor={color.frameColor || '#18181B'} />
            <stop offset="100%" stopColor={color.frameColor === '#18181B' ? '#09090B' : color.templeColor || '#0F172A'} />
          </linearGradient>

          {/* Authentic Natural Woodgrain Gradient */}
          <linearGradient id={woodId} x1="0%" y1="0%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#C89D65" />
            <stop offset="25%" stopColor="#E2B176" />
            <stop offset="50%" stopColor="#A07242" />
            <stop offset="75%" stopColor="#D4A373" />
            <stop offset="100%" stopColor="#8C6239" />
          </linearGradient>

          {/* Crystal Clear AR Coated Optical Lens Gradient */}
          <linearGradient id={lensId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0.18)" />
            <stop offset="45%" stopColor="rgba(255, 255, 255, 0.28)" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.14)" />
          </linearGradient>
        </defs>

        {/* Temples (Gọng hai bên với chất liệu Gỗ hoặc Kim loại/Acetate) */}
        <path
          d="M 16 36 Q -15 26 -38 42"
          stroke={isWood ? `url(#${woodId})` : (color.templeColor || '#334155')}
          strokeWidth={isWood ? "6" : "4.5"}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M 224 36 Q 255 26 278 42"
          stroke={isWood ? `url(#${woodId})` : (color.templeColor || '#334155')}
          strokeWidth={isWood ? "6" : "4.5"}
          strokeLinecap="round"
          fill="none"
        />

        {/* Bridge (Cầu mũi) */}
        <path d="M 94 40 Q 120 32 146 40" stroke={`url(#${gradId})`} strokeWidth="7" strokeLinecap="round" fill="none" />

        {/* Nose pads (Đệm mũi) */}
        <ellipse cx="102" cy="50" rx="3.5" ry="6.5" fill="#F8FAFC" opacity="0.9" stroke="#94A3B8" strokeWidth="0.8" />
        <ellipse cx="138" cy="50" rx="3.5" ry="6.5" fill="#F8FAFC" opacity="0.9" stroke="#94A3B8" strokeWidth="0.8" />

        {/* Lenses and Frame Rims by Shape */}
        {shape === 'aviator' && (
          <>
            <path d="M 18 30 C 18 20, 94 20, 94 30 C 94 68, 70 88, 56 88 C 30 88, 18 68, 18 30 Z" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="4.8" />
            <path d="M 222 30 C 222 20, 146 20, 146 30 C 146 68, 170 88, 184 88 C 210 88, 222 68, 222 30 Z" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="4.8" />
            <path d="M 26 22 L 214 22" stroke={`url(#${gradId})`} strokeWidth="3.2" strokeLinecap="round" />
          </>
        )}

        {shape === 'square' && (
          <>
            <rect x="18" y="22" width="78" height="60" rx="10" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="8" />
            <rect x="144" y="22" width="78" height="60" rx="10" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="8" />
            {/* Metallic corner pins */}
            <circle cx="26" cy="29" r="2.2" fill="#E2E8F0" stroke="#475569" strokeWidth="0.6" />
            <circle cx="214" cy="29" r="2.2" fill="#E2E8F0" stroke="#475569" strokeWidth="0.6" />
          </>
        )}

        {shape === 'cateye' && (
          <>
            <path d="M 16 28 C 42 26, 80 34, 94 42 C 94 68, 74 84, 52 84 C 26 84, 16 64, 16 48 Z" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="7" />
            <path d="M 224 28 C 198 26, 160 34, 146 42 C 146 68, 166 84, 188 84 C 214 84, 224 64, 224 48 Z" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="7" />
            <polygon points="16,28 24,20 30,26 22,32" fill="#E8C97A" />
            <polygon points="224,28 216,20 210,26 218,32" fill="#E8C97A" />
          </>
        )}

        {shape === 'clubmaster' && (
          <>
            <path d="M 18 24 Q 58 18 96 28 L 96 74 Q 58 84 18 74 Z" fill={`url(#${lensId})`} stroke="#CBD5E1" strokeWidth="2.5" />
            <path d="M 144 28 Q 182 18 222 24 L 222 74 Q 182 84 144 74 Z" fill={`url(#${lensId})`} stroke="#CBD5E1" strokeWidth="2.5" />
            <path d="M 14 24 Q 58 14 98 26" stroke={`url(#${gradId})`} strokeWidth="8.5" strokeLinecap="round" fill="none" />
            <path d="M 142 26 Q 182 14 226 24" stroke={`url(#${gradId})`} strokeWidth="8.5" strokeLinecap="round" fill="none" />
            <circle cx="22" cy="24" r="2.2" fill="#F59E0B" />
            <circle cx="218" cy="24" r="2.2" fill="#F59E0B" />
          </>
        )}

        {shape === 'round' && (
          <>
            <circle cx="60" cy="56" r="34" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="6" />
            <circle cx="180" cy="56" r="34" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="6" />
          </>
        )}

        {shape === 'rimless' && (
          <>
            <ellipse cx="58" cy="54" rx="38" ry="26" fill={`url(#${lensId})`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeDasharray="5 3" />
            <ellipse cx="182" cy="54" rx="38" ry="26" fill={`url(#${lensId})`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeDasharray="5 3" />
            <circle cx="22" cy="54" r="3.5" fill={color.frameColor || '#10B981'} />
            <circle cx="94" cy="54" r="3.5" fill={color.frameColor || '#10B981'} />
            <circle cx="146" cy="54" r="3.5" fill={color.frameColor || '#10B981'} />
            <circle cx="218" cy="54" r="3.5" fill={color.frameColor || '#10B981'} />
          </>
        )}

        {shape === 'geometric' && (
          <>
            <polygon points="24,34 60,20 96,34 96,72 60,86 24,72" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="5.5" />
            <polygon points="144,34 180,20 216,34 216,72 180,86 144,72" fill={`url(#${lensId})`} stroke={`url(#${gradId})`} strokeWidth="5.5" />
          </>
        )}

        {/* Specular glare reflections */}
        <path d="M 38 36 L 72 76" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" />
        <path d="M 46 36 L 80 76" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 162 36 L 196 76" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" />
        <path d="M 170 36 L 204 76" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  };

  // Generate Try-on snapshot on-the-fly for appointment data
  const generateTryonPhotoNow = async (): Promise<string | null> => {
    if (capturedPhoto) return capturedPhoto;
    return await createCompositedSnapshot();
  };

  // Direct Booking Handler
  const handleDirectBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);
    setIsSubmittingBooking(true);

    const liveSnapshot = capturedPhoto || (await generateTryonPhotoNow());
    const chosenColor = selectedGlasses?.colors[selectedColorIdx] || selectedGlasses?.colors[0];
    const frameDetail = selectedGlasses ? `[Ướm thử Gương AI AR: ${selectedGlasses.brand} ${selectedGlasses.name} (${chosenColor?.name || ''}) - Giá: ${selectedGlasses.price} (${currentMatchAnalysis.badgeLabel})]` : '';

    // Ensure the frame detail is included in notes
    const finalNotes = selectedGlasses && bookingFormData.notes.includes(selectedGlasses.name)
      ? bookingFormData.notes
      : `${frameDetail} ${bookingFormData.notes}`.trim();

    const payload = {
      fullName: bookingFormData.fullName.trim(),
      phone: bookingFormData.phone.trim(),
      appointmentDate: bookingFormData.appointmentDate,
      appointmentTime: bookingFormData.appointmentTime,
      gender: bookingFormData.gender,
      type: bookingFormData.serviceType,
      photoUrl: liveSnapshot || '',
      tryonPhoto: liveSnapshot || '',
      notes: finalNotes
    };

    try {
      const res = await fetch('/api/public/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBookingSuccessResult(data);
      } else {
        setBookingError(data.message || 'Không thể tạo lịch hẹn. Vui lòng kiểm tra lại thông tin.');
      }
    } catch (err: any) {
      setBookingError('Lỗi kết nối máy chủ. Vui lòng gọi Hotline 0989.435.160 để được xếp lịch ngay.');
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const handleSelectCurrentFrame = async () => {
    if (!selectedGlasses) return;

    // Auto capture snapshot photo if live camera is active
    if (!capturedPhoto) {
      const autoSnap = await generateTryonPhotoNow();
      if (autoSnap) setCapturedPhoto(autoSnap);
    }

    const chosenColor = selectedGlasses.colors[selectedColorIdx] || selectedGlasses.colors[0];
    const frameNote = `Ướm thử gọng kính: ${selectedGlasses.brand} ${selectedGlasses.name} (${chosenColor.name}) - Giá: ${selectedGlasses.price} (${currentMatchAnalysis.badgeLabel})`;

    setBookingFormData(prev => ({
      ...prev,
      notes: prev.notes && !prev.notes.includes(selectedGlasses.name) ? `${frameNote}. ${prev.notes}` : frameNote
    }));

    setBookingError(null);
    setBookingSuccessResult(null);
    setIsBookingModalOpen(true);

    if (onSelectGlasses) {
      onSelectGlasses({
        id: selectedGlasses.id,
        name: selectedGlasses.name,
        brand: selectedGlasses.brand,
        price: selectedGlasses.price,
        colorName: selectedGlasses.colors[selectedColorIdx]?.name || '',
        colorHex: selectedGlasses.colors[selectedColorIdx]?.hex || '#000000'
      });
    }
  };

  return (
    <div className="ar-camera-app-root">
      {/* 1. TOP FLOATING HUD BAR */}
      <header className="ar-hud-top-bar">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="ar-hud-btn ar-back-btn"
            title="Đóng phòng thử kính"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          <Link href="/" className="ar-hud-btn ar-back-btn" title="Quay lại trang chủ">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}

        {/* Center Status Pill */}
        <div className="ar-live-status-pill">
          <span className={`status-dot ${isCameraActive ? 'is-live' : 'is-idle'}`} />
          <span className="status-title flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>PHÒNG THỬ KÍNH AR</span>
          </span>
        </div>

        {/* Right Tools: flip camera when active & Close Button if modal */}
        <div className="ar-top-tools-cluster flex items-center gap-2">
          {isCameraActive && (
            <button
              type="button"
              className="ar-hud-tool-btn"
              onClick={flipCamera}
              title="Đổi Camera Trước / Sau"
            >
              <SwitchCamera className="w-4 h-4 text-amber-300" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="ar-hud-tool-btn hover:!bg-red-500/20 hover:!text-red-400"
              onClick={onClose}
              title="Đóng phòng thử kính"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* 2. CENTER FULL-SCREEN VIEWPORT CAMERA */}
      <main ref={viewportRef} className="ar-camera-viewport">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className={`ar-video-stream ${facingMode === 'user' ? 'mirrored' : ''} ${isCameraActive ? 'visible' : 'hidden'}`}
        />

        {uploadedPhotoUrl && !isCameraActive && (
          <img
            src={uploadedPhotoUrl}
            alt="Uploaded Portrait"
            className="ar-uploaded-img-view"
          />
        )}

        {/* Launch Prompt Placeholder */}
        {!isCameraActive && !uploadedPhotoUrl && (
          <div className="ar-camera-launch-placeholder">
            <div className="launch-card-inner">
              <div className="launch-radar-anim">
                <span className="radar-ring r1" />
                <span className="radar-ring r2" />
                <span className="radar-icon">
                  <Camera className="w-8 h-8 text-amber-400 stroke-[1.8]" />
                </span>
              </div>
              <h3>Gương Thử Kính AI AR Trực Tiếp</h3>
              <p>
                AI Face Mesh tự động quét và bám theo khuôn mặt thời gian thực.
              </p>

              {cameraError && (
                <div className="camera-error-banner">
                  ⚠️ {cameraError}
                </div>
              )}

              <div className="launch-action-row">
                <button
                  type="button"
                  onClick={() => startCamera('user')}
                  disabled={isCameraStarting}
                  className="ar-launch-camera-btn"
                >
                  <Sparkles className="w-4 h-4 text-amber-950" />
                  <span>{isCameraStarting ? 'Đang Khởi Động Camera...' : 'Bật Camera Thử Kính Ngay'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ar-launch-upload-btn"
                >
                  <UploadCloud className="w-4 h-4 text-amber-300" />
                  <span>Hoặc Tải Ảnh Chân Dung Lên</span>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handlePhotoUpload}
                />
              </div>
            </div>
          </div>
        )}

        {/* 3D Model Loading Progress Indicator */}
        {modelLoadingProgress !== null && (
          <div className="ar-model-loading-pill">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="text-xs font-semibold text-white tracking-wide">
                Đang tải mô hình 3D... {modelLoadingProgress}%
              </span>
            </div>
            <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden mt-1.5">
              <div
                className="bg-gradient-to-r from-amber-400 to-yellow-300 h-full rounded-full transition-all duration-200"
                style={{ width: `${Math.max(8, modelLoadingProgress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Biometric 468 Face Mesh Wireframe Points & Connected Links (Active during 10s scan) */}
        <canvas
          ref={faceMeshCanvasRef}
          className={`ar-facemesh-scan-canvas transition-opacity duration-500 ${isInitialScanning && (isCameraActive || uploadedPhotoUrl) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        />

        {/* 3. COMPUTER VISION 3D AR GLASSES LAYER (Delayed until 10s scan finishes) */}
        <canvas
          ref={threeCanvasRef}
          className={`ar-threejs-canvas-overlay transition-opacity duration-700 ${!isInitialScanning && (isCameraActive || uploadedPhotoUrl) && selectedGlasses?.model3dUrl ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        />

        {!isInitialScanning && (isCameraActive || uploadedPhotoUrl) && selectedGlasses && !selectedGlasses.model3dUrl && (
          <div
            className="ar-glasses-interactive-layer animate-fade-in"
            style={{
              left: `${isAutoTrackingEnabled && facePose.detected ? facePose.x : 50}%`,
              top: `${(isAutoTrackingEnabled && facePose.detected ? facePose.y : 43) + (manualOffsetY / 10)}%`,
              width: `${(isAutoTrackingEnabled && facePose.detected ? facePose.widthPx : 310) * manualScale}px`,
              transform: `translate(-50%, -50%) rotate(${isAutoTrackingEnabled && facePose.detected ? facePose.rollDeg : 0}deg)`,
              pointerEvents: 'none'
            }}
          >
            {renderRealisticGlassesSVG(selectedGlasses, selectedColorIdx)}
          </div>
        )}

        {/* 10-SECOND INITIAL BIOMETRIC SCANNING HUD OVERLAY */}
        {isInitialScanning && (isCameraActive || uploadedPhotoUrl) && (
          <div className="ar-scan-hud-overlay">
            {/* Center Dynamic Face Target Scanner */}
            <div
              className="scan-target-box"
              style={{
                left: `${isAutoTrackingEnabled && facePose.detected ? facePose.x : 50}%`,
                top: `${isAutoTrackingEnabled && facePose.detected ? facePose.y : 43}%`,
                width: `${Math.max(220, (isAutoTrackingEnabled && facePose.detected ? facePose.widthPx : 280) * 1.15)}px`,
                height: `${Math.max(260, (isAutoTrackingEnabled && facePose.detected ? facePose.widthPx : 280) * 1.35)}px`,
                transform: `translate(-50%, -50%) rotate(${isAutoTrackingEnabled && facePose.detected ? facePose.rollDeg : 0}deg)`
              }}
            >
              {/* Laser Sweep Beam */}
              <div className="scan-laser-sweep" />

              {/* Holographic Target Corners */}
              <span className="scan-corner sc-tl" />
              <span className="scan-corner sc-tr" />
              <span className="scan-corner sc-bl" />
              <span className="scan-corner sc-br" />

              {/* Biometric Mesh Overlay */}
              <div className="scan-mesh-grid-anim">
                <div className="mesh-ring mr-1" />
                <div className="mesh-ring mr-2" />
                <div className="mesh-crosshair" />
              </div>

              {/* Real-time Ticker Tag */}
              <div className="scan-live-tag">
                <span className="live-dot" />
                <span>AI BIOMETRIC TRACKING • 468 PTS</span>
              </div>
            </div>

            {/* Futuristic Sci-Fi HUD Loader Card (Matches Reference Image) */}
            <div className="ar-sci-hud-loader-card">
              {/* Clean title text at top indicating what's currently loading */}
              <div className="sci-hud-title-bar">
                <span className="sci-hud-pulse-dot" />
                <span className="sci-hud-title-text">{scanStageInfo.title}</span>
                <span className="sci-hud-subtitle-text">• {scanStageInfo.subtitle}</span>
              </div>

              {/* HUD Holographic Bar */}
              <div className="sci-hud-bar-wrapper">
                {/* Left Circular Percentage Dial */}
                <div className="sci-hud-circle-dial">
                  <div className="sci-dial-outer-arc" />
                  <div className="sci-dial-glow-disc">
                    <span className="sci-dial-val">{scanPercent}%</span>
                  </div>
                </div>

                {/* Right Chamfered Segmented Equalizer Track */}
                <div className="sci-hud-track-box">
                  <div className="sci-segmented-bars-row">
                    {Array.from({ length: 36 }).map((_, idx) => {
                      const threshold = (idx / 36) * 100;
                      const isFilled = scanPercent >= threshold;
                      return (
                        <span
                          key={idx}
                          className={`sci-bar-notch ${isFilled ? 'is-filled' : ''}`}
                        />
                      );
                    })}
                  </div>

                  <div className="sci-track-bottom-row">
                    <span className="sci-loading-ticker">LOADING...</span>
                    <button
                      type="button"
                      onClick={skipOrFinishScan}
                      className="sci-skip-link"
                    >
                      Bỏ qua ➔
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scan Completed Celebratory Toast (Frameless 3D Embossed Futuristic Typography) */}
        {scanJustCompleted && (
          <div
            className="ar-scan-completed-toast animate-toast-cinematic"
            onClick={() => setScanJustCompleted(false)}
            role="button"
            tabIndex={0}
            title="Bấm để đóng thông báo"
          >
            <div className="sci-toast-content">
              {/* Top Embossed Sub-header */}
              <div className="sci-toast-header">
                <span className="sci-toast-icon">✨</span>
                <span className="sci-toast-label">Hoàn tất nhận diện</span>
                <span className="sci-toast-match-badge">Khớp 98%</span>
                <button
                  type="button"
                  className="sci-toast-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScanJustCompleted(false);
                  }}
                  title="Đóng thông báo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Main Embossed 3D Face Shape Heading */}
              <div className="sci-toast-title">
                Dáng mặt: <span className="sci-toast-face-name">
                  {currentFaceShape === 'oval' ? 'Trái Xoan (Oval)' :
                    currentFaceShape === 'round' ? 'Mặt Tròn (Round)' :
                      currentFaceShape === 'square' ? 'Mặt Vuông (Square)' :
                        currentFaceShape === 'heart' ? 'Trái Tim (Heart)' : 'Kim Cương (Diamond)'}
                </span>
              </div>

              {/* Embossed Sub-caption */}
              <div className="sci-toast-desc">
                Đã tự động ướm dáng kính phù hợp tỷ lệ vàng khuôn mặt!
              </div>

              {/* Glowing Laser Underline Divider */}
              <div className="sci-toast-laser-line" />
            </div>
          </div>
        )}

        {/* Dynamic Live Floating Face Diagnostic Pill (Revealed only after scan) */}
        {!isInitialScanning && (isCameraActive || uploadedPhotoUrl) && (
          <div className="ar-floating-diagnosis-pill animate-fade-in" onClick={() => setShowDiagnosisModal(true)}>
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Dáng Mặt: <strong>
                {currentFaceShape === 'oval' ? 'Trái Xoan (Oval)' :
                  currentFaceShape === 'round' ? 'Mặt Tròn (Round)' :
                    currentFaceShape === 'square' ? 'Mặt Vuông (Square)' :
                      currentFaceShape === 'heart' ? 'Trái Tim (Heart)' : 'Kim Cương (Diamond)'}
              </strong>
            </span>
            <span
              className="diag-match-badge"
              style={{
                color: currentMatchAnalysis.badgeColor,
                backgroundColor: currentMatchAnalysis.badgeBg,
                borderColor: currentMatchAnalysis.badgeColor
              }}
            >
              {currentMatchAnalysis.badgeLabel}
            </span>
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </div>
        )}

        {/* Floating Precision Micro-Tuning Controls (Revealed only after scan) */}
        {!isInitialScanning && (isCameraActive || uploadedPhotoUrl) && (
          <>
            {/* Mobile-Only Floating Tuning Toggle Pill */}
            <button
              type="button"
              className={`ar-mobile-tuning-toggle ${isTuningPanelOpen ? 'active' : ''}`}
              onClick={() => setIsTuningPanelOpen(!isTuningPanelOpen)}
              title="Tinh chỉnh kích thước & vị trí kính"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-300" />
              <span>{isTuningPanelOpen ? 'Đóng' : 'Chỉnh Kính'}</span>
            </button>

            {/* Micro-Tuning Control Panel (Always visible on Desktop, Expandable on Mobile) */}
            <div className={`ar-floating-zoom-control ${isTuningPanelOpen ? 'is-mobile-open' : ''}`}>
              {/* Mobile Close Header */}
              <div className="tuning-mobile-header">
                <span className="text-[10px] font-extrabold tracking-wider text-amber-300 uppercase">Tinh Chỉnh Gọng</span>
                <button
                  type="button"
                  className="tuning-close-btn"
                  onClick={() => setIsTuningPanelOpen(false)}
                >
                  <X className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>

              {/* Scale / Kích Thước */}
              <div className="zoom-group">
                <span className="tuning-axis-label">SIZE</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualScale(s => +(Math.min(1.5, s + 0.02)).toFixed(2))}
                  title="Phóng to gọng kính (+2%)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <span className="zoom-value">{Math.round(manualScale * 100)}%</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualScale(s => +(Math.max(0.7, s - 0.02)).toFixed(2))}
                  title="Thu nhỏ gọng kính (-2%)"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divider-line" />

              {/* Position Y / Cao Thấp */}
              <div className="zoom-group">
                <span className="tuning-axis-label">VỊ TRÍ</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualOffsetY(y => +(y - 1).toFixed(1))}
                  title="Nâng cao vị trí"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualOffsetY(y => +(y + 1).toFixed(1))}
                  title="Hạ thấp vị trí"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divider-line" />

              {/* Depth Z / Tiến Lùi Độ Sâu */}
              <div className="zoom-group">
                <span className="tuning-axis-label">ĐỘ SÂU</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualOffsetZ(z => +(z + 0.5).toFixed(1))}
                  title="Đẩy kính xa mặt hơn (tránh cấn má/tai)"
                >
                  <span className="text-[10px] font-bold">Z+</span>
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualOffsetZ(z => +(z - 0.5).toFixed(1))}
                  title="Áp sát sống mũi hơn"
                >
                  <span className="text-[10px] font-bold">Z-</span>
                </button>
              </div>

              <div className="divider-line" />

              {/* Pantoscopic Tilt / Nghiêng Góc */}
              <div className="zoom-group">
                <span className="tuning-axis-label">GÓC</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualTilt(t => +(t + 2).toFixed(0))}
                  title="Nghiêng gọng kính cụp xuống má"
                >
                  <span className="text-[10px] font-bold">∠+</span>
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setManualTilt(t => +(t - 2).toFixed(0))}
                  title="Nghiêng gọng ngửa lên trán"
                >
                  <span className="text-[10px] font-bold">∠-</span>
                </button>
              </div>

              <div className="divider-line" />

              {/* Reset All */}
              <button
                type="button"
                className="zoom-reset-btn"
                onClick={() => {
                  setManualScale(1.0);
                  setManualOffsetY(0);
                  setManualOffsetX(0);
                  setManualOffsetZ(0);
                  setManualTilt(0);
                }}
                title="Đặt lại vị trí chuẩn mặc định"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </main>

      {/* 4. BOTTOM FLOATING CONSOLE ISLAND */}
      <footer className={`ar-bottom-dock ${isDockCollapsed ? 'is-collapsed' : ''}`}>
        {/* Dock Collapse / Expand Toggle Button */}
        <div className="ar-dock-toggle-row">
          <button
            type="button"
            className="ar-dock-collapse-toggle-btn"
            onClick={() => setIsDockCollapsed(!isDockCollapsed)}
            title={isDockCollapsed ? "Mở rộng danh mục kính" : "Thu gọn thanh điều khiển"}
          >
            <span className="flex items-center gap-1">
              {isDockCollapsed ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Mở Rộng Danh Mục Kính</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Thu Gọn Thanh Điều Khiển</span>
                </>
              )}
            </span>
          </button>
        </div>

        {isLoadingCatalog || glassesCatalog.length === 0 ? (
          <div className="ar-empty-inventory-banner" role="status">
            <span className="text-2xl mb-1">📦</span>
            <h4 className="text-sm font-bold text-white">
              {isLoadingCatalog ? 'Đang tải danh mục gọng kính...' : catalogError || 'Chưa có gọng kính để thử'}
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              {isLoadingCatalog ? 'Vui lòng chờ trong giây lát.' : 'Vui lòng quay lại sau hoặc liên hệ phòng khám.'}
            </p>
          </div>
        ) : selectedGlasses ? (
          <>
            {isDockCollapsed ? (
              /* Streamlined Mini Collapsed Dock Bar */
              <div className="ar-mini-collapsed-dock">
                <div className="mini-frame-info">
                  <span className="mini-brand">{selectedGlasses.brand}</span>
                  <span className="mini-name">{selectedGlasses.name}</span>
                  <span className="mini-price">{selectedGlasses.price}</span>
                </div>

                <div className="mini-actions-cluster">
                  <button
                    type="button"
                    className="ar-mini-expand-btn flex items-center gap-1"
                    onClick={() => setIsDockCollapsed(false)}
                    title="Chọn mẫu kính khác"
                  >
                    <Glasses className="w-3.5 h-3.5 text-amber-300" />
                    <span>Đổi Mẫu</span>
                  </button>

                  <button
                    type="button"
                    className="ar-shutter-capture-btn mini-shutter"
                    onClick={takeSnapshot}
                    disabled={isCapturing || (!isCameraActive && !uploadedPhotoUrl)}
                    title="Chụp ảnh thử kính"
                  >
                    <div className="shutter-inner-ring">
                      <Camera className="w-4 h-4 text-slate-950 stroke-[2.4]" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleSelectCurrentFrame}
                    className="ar-book-frame-cta-btn mini-book flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-slate-950 text-slate-950" />
                    <span>ĐẶT LỊCH</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Expanded Full Dock */
              <>
                {/* Active Model Header with Single Clean 3D Button & Color Swatches */}
                <div className="ar-dock-header-row">
                  <div className="active-frame-details">
                    <span className="active-brand-tag">{selectedGlasses.brand}</span>
                    <h4 className="active-frame-name">{selectedGlasses.name}</h4>
                    <span className="active-price-text">{selectedGlasses.price}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {selectedGlasses.model3dUrl && (
                      <button
                        type="button"
                        className="ar-view-3d-action-btn flex items-center gap-1.5"
                        onClick={() => setIs3DViewerOpen(true)}
                        title="Xem mô hình 3D 360° tương tác"
                      >
                        <Box className="w-3.5 h-3.5 text-amber-300" />
                        <span className="btn-text">Xem 3D 360°</span>
                      </button>
                    )}

                    <div className="active-swatches-cluster">
                      <div className="swatches-pill-list">
                        {selectedGlasses.colors.map((c, idx) => (
                          <button
                            key={c.name}
                            type="button"
                            className={`swatch-pill-btn ${selectedColorIdx === idx ? 'active' : ''}`}
                            onClick={() => setSelectedColorIdx(idx)}
                            style={{ backgroundColor: c.hex }}
                            title={c.name}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Category Filters */}
                <div className="ar-category-filter-row">
                  <div className="filter-pill-chips">
                    {[
                      { id: 'all', label: 'Tất Cả' },
                      { id: 'titan', label: 'Titanium' },
                      { id: 'acetate', label: 'Acetate' },
                      { id: 'square', label: 'Vuông' },
                      { id: 'round', label: 'Tròn' },
                      { id: 'cateye', label: 'Mắt Mèo' },
                      { id: 'aviator', label: 'Phi Công' },
                      { id: 'rimless', label: 'Gọng Khoan' },
                      { id: 'geometric', label: 'Đa Giác' },
                    ]
                      .filter(cat => cat.id === 'all' || (categoryCounts[cat.id] ?? 0) > 0)
                      .map(cat => {
                        const count = categoryCounts[cat.id] ?? 0;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            className={`cat-chip-btn ${activeCategory === cat.id ? 'active' : ''}`}
                            onClick={() => setActiveCategory(cat.id)}
                          >
                            <span>{cat.label}</span>
                            <span className="cat-count-badge">({count})</span>
                          </button>
                        );
                      })}
                  </div>

                  <button
                    type="button"
                    className={`filter-toggle-face-btn flex items-center gap-1.5 ${filterByMyFace ? 'active' : ''}`}
                    onClick={() => setFilterByMyFace(!filterByMyFace)}
                    title="Lọc mẫu kính hợp dáng mặt tôi"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>{filterByMyFace ? `Đang Lọc Dáng Mặt (${matchingFaceCount})` : `Lọc Hợp Mặt Tôi (${matchingFaceCount})`}</span>
                  </button>
                </div>

                {/* macOS-style Bubble Dock Product Strip */}
                <div
                  className="ar-glasses-carousel-container"
                  ref={(el) => {
                    if (!el) return;
                    let isDown = false;
                    let startX = 0;
                    let scrollLeft = 0;
                    el.onmousedown = (e) => { isDown = true; el.classList.add('is-dragging'); startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; };
                    el.onmouseup = () => { isDown = false; el.classList.remove('is-dragging'); };

                    const track = el.querySelector('.ar-glasses-carousel-track') as HTMLElement;
                    if (!track) return;

                    el.onmousemove = (e) => {
                      if (isDown) {
                        e.preventDefault();
                        const x = e.pageX - el.offsetLeft;
                        el.scrollLeft = scrollLeft - (x - startX) * 1.8;
                        return;
                      }

                      const cards = track.children as HTMLCollectionOf<HTMLElement>;
                      const mouseX = e.clientX;
                      let closestIdx = -1;
                      let minDistance = Infinity;

                      for (let i = 0; i < cards.length; i++) {
                        const card = cards[i];
                        const rect = card.getBoundingClientRect();
                        const cardCenterX = rect.left + rect.width / 2;
                        const dist = Math.abs(mouseX - cardCenterX);
                        if (dist < minDistance) {
                          minDistance = dist;
                          closestIdx = i;
                        }

                        const maxDist = 180;
                        const scale = dist < maxDist
                          ? 1 + 0.38 * Math.cos((dist / maxDist) * (Math.PI / 2))
                          : 1;
                        const liftY = (scale - 1) * 22;
                        card.style.transform = `scale(${scale}) translateY(-${liftY}px)`;

                        // 3D perspective tilt on preview
                        const preview = card.querySelector('.carousel-card-preview') as HTMLElement;
                        if (preview) {
                          const tiltY = dist < maxDist ? ((mouseX - cardCenterX) / maxDist) * -18 : 0;
                          preview.style.transform = `rotateY(${tiltY}deg) scale(${dist < 60 ? 1.08 : 1})`;
                        }
                      }

                      // Show floating pill label ONLY on the single closest card
                      for (let i = 0; i < cards.length; i++) {
                        const infoEl = cards[i].querySelector('.carousel-card-info') as HTMLElement;
                        if (infoEl) {
                          if (i === closestIdx && minDistance < 90) {
                            infoEl.style.opacity = '1';
                            infoEl.style.transform = 'translateX(-50%) translateY(0) scale(1)';
                            infoEl.style.pointerEvents = 'auto';
                          } else {
                            infoEl.style.opacity = '0';
                            infoEl.style.transform = 'translateX(-50%) translateY(6px) scale(0.9)';
                            infoEl.style.pointerEvents = 'none';
                          }
                        }
                      }
                    };

                    el.onmouseleave = () => {
                      isDown = false;
                      el.classList.remove('is-dragging');
                      const cards = track.children as HTMLCollectionOf<HTMLElement>;
                      for (let i = 0; i < cards.length; i++) {
                        cards[i].style.transform = 'scale(1) translateY(0)';
                        const preview = cards[i].querySelector('.carousel-card-preview') as HTMLElement;
                        if (preview) preview.style.transform = 'rotateY(0deg) scale(1)';
                        const infoEl = cards[i].querySelector('.carousel-card-info') as HTMLElement;
                        if (infoEl) {
                          infoEl.style.opacity = '0';
                          infoEl.style.transform = 'translateX(-50%) translateY(6px) scale(0.9)';
                          infoEl.style.pointerEvents = 'none';
                        }
                      }
                    };
                  }}
                >
                  <div className="ar-glasses-carousel-track">
                    {filteredCatalog.map((glasses) => {
                      const isSelected = selectedGlasses.id === glasses.id;

                      return (
                        <div
                          key={glasses.id}
                          className={`ar-glasses-carousel-card ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            setSelectedGlasses(glasses);
                            setSelectedColorIdx(0);
                          }}
                        >
                          {/* Floating Liquid Glass Pill Label */}
                          <div className="carousel-card-info">
                            <span className="carousel-card-brand">{glasses.brand}</span>
                            <span className="carousel-card-dot">•</span>
                            <h5 className="carousel-card-name">{glasses.name}</h5>
                            <span className="carousel-card-price">{glasses.price}</span>
                          </div>

                          <div className="carousel-card-preview">
                            {glasses.image || modelThumbnails[glasses.id] ? (
                              <img
                                src={glasses.image || modelThumbnails[glasses.id]}
                                alt={glasses.name}
                                className="w-full h-full object-contain filter drop-shadow-md"
                              />
                            ) : (
                              renderRealisticGlassesSVG(glasses, selectedGlasses?.id === glasses.id ? selectedColorIdx : 0)
                            )}
                          </div>

                          {/* Selected indicator: small gold tick dot below */}
                          {isSelected && (
                            <div className="carousel-selected-tick">
                              <Check className="w-2.5 h-2.5" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Action Dock Bar (Clean single-line CTA) */}
                <div className="ar-action-dock-bar">
                  <button
                    type="button"
                    className="ar-shutter-capture-btn"
                    onClick={takeSnapshot}
                    disabled={isCapturing || (!isCameraActive && !uploadedPhotoUrl)}
                    title="Chụp ảnh lưu khoảnh khắc thử kính"
                  >
                    <div className="shutter-inner-ring">
                      <Camera className="w-5 h-5 text-slate-950 stroke-[2.4]" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleSelectCurrentFrame}
                    className="ar-book-frame-cta-btn flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 fill-slate-950 text-slate-950" />
                    <span className="btn-title">ĐẶT LỊCH GIỮ MẪU NÀY (-10% ƯU ĐÃI)</span>
                    <ArrowRight className="w-4 h-4 text-slate-950" />
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </footer>
      {/* 6. SNAPSHOT CAPTURE MODAL */}
      {capturedPhoto && (
        <div className="ar-snapshot-modal-overlay" onClick={() => setCapturedPhoto(null)}>
          <div className="ar-snapshot-card" onClick={e => e.stopPropagation()}>
            <div className="snapshot-header">
              <div className="snapshot-header-titles">
                <span className="snapshot-badge-gold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>AI AR PORTRAIT CAPTURE</span>
                </span>
                <h4 className="snapshot-main-title">Ảnh Thử Kính Chân Thực Của Bạn</h4>
              </div>
              <button
                type="button"
                onClick={() => setCapturedPhoto(null)}
                className="snapshot-close-btn"
                title="Đóng ảnh"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedGlasses && (
              <div className="snapshot-info-pill">
                <div className="flex items-center gap-2">
                  <Glasses className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="snapshot-frame-name">
                    {selectedGlasses.brand} {selectedGlasses.name}
                  </span>
                  <span className="text-xs text-amber-300 font-bold">
                    • {selectedGlasses.price}
                  </span>
                </div>
                <span
                  className="diag-match-badge"
                  style={{
                    color: currentMatchAnalysis.badgeColor,
                    backgroundColor: currentMatchAnalysis.badgeBg,
                    borderColor: currentMatchAnalysis.badgeColor
                  }}
                >
                  {currentMatchAnalysis.badgeLabel}
                </span>
              </div>
            )}

            <div className="snapshot-preview-frame">
              <img src={capturedPhoto} alt="Snapshot Result" className="snapshot-img" />
            </div>

            <div className="snapshot-actions-row">
              <a
                href={capturedPhoto}
                download={`LeQuynhOptic_${selectedGlasses?.id || 'tryon'}_${Date.now()}.jpg`}
                className="snapshot-download-btn"
              >
                <Download className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <span>Tải Ảnh Về Máy</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setCapturedPhoto(null);
                  handleSelectCurrentFrame();
                }}
                className="snapshot-book-btn"
              >
                <Sparkles className="w-4 h-4 fill-slate-950 text-slate-950 flex-shrink-0" />
                <span>Đặt Lịch Giữ Mẫu Này</span>
                <ArrowRight className="w-4 h-4 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. DYNAMIC FACE SHAPE DIAGNOSIS & MATCH EXPLANATION MODAL */}
      {showDiagnosisModal && (
        <div className="ar-diagnosis-modal-overlay" onClick={() => setShowDiagnosisModal(false)}>
          <div className="ar-diagnosis-card luxury-modal-glow" onClick={e => e.stopPropagation()}>
            <div className="diag-header-lux">
              <div className="diag-header-titles">
                <span className="diag-badge-gold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>AI BIOMETRIC & OPTICAL HARMONY</span>
                </span>
                <h3 className="diag-main-title">Chẩn Đoán Tỷ Lệ & Tương Thích Gọng Kính</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagnosisModal(false)}
                className="diag-close-lux"
                title="Đóng bảng chẩn đoán"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="diag-body-lux">
              {/* Face Shape Mode Switcher (Auto AI vs Manual) */}
              <div className="face-shape-mode-box">
                <div className="mode-box-header">
                  <span className="mode-title-tag">CHẾ ĐỘ QUÉT DÁNG MẶT:</span>
                  <span className={`mode-status-indicator ${manualFaceShape === null ? 'is-auto' : 'is-manual'}`}>
                    {manualFaceShape === null ? (
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" />
                        <span>AI Đang Tự Động Quét 60 FPS</span>
                      </span>
                    ) : (
                      <span>Đang Chọn Thủ Công</span>
                    )}
                  </span>
                </div>

                <div className="face-shape-chips-row">
                  {/* Default AI Auto Button */}
                  <button
                    type="button"
                    className={`shape-chip-btn chip-auto-btn flex items-center gap-1.5 ${manualFaceShape === null ? 'active' : ''}`}
                    onClick={() => setManualFaceShape(null)}
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Tự Động (AI Live Scan)</span>
                    {manualFaceShape === null && <span className="chip-active-dot" />}
                  </button>

                  {[
                    { id: 'round', label: 'Mặt Tròn' },
                    { id: 'square', label: 'Mặt Vuông' },
                    { id: 'oval', label: 'Trái Xoan' },
                    { id: 'heart', label: 'Trái Tim' },
                    { id: 'diamond', label: 'Kim Cương' },
                  ].map(shape => (
                    <button
                      key={shape.id}
                      type="button"
                      className={`shape-chip-btn flex items-center gap-1 ${currentFaceShape === shape.id && manualFaceShape !== null ? 'active' : ''}`}
                      onClick={() => setManualFaceShape(shape.id as FaceShapeType)}
                    >
                      <span>{shape.label}</span>
                      {manualFaceShape === shape.id && <Check className="w-3 h-3 text-amber-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Biometric Telemetry Breakdown (4 Cards) */}
              <div className="face-telemetry-panel">
                <div className="tel-panel-head">
                  <span className="tel-panel-title">CHỈ SỐ NHÂN TRẮC HỌC KHUÔN MẶT (LIVE TELEMETRY)</span>
                  <span className="tel-live-tag">REAL-TIME</span>
                </div>
                <div className="telemetry-grid">
                  <div className="telemetry-item">
                    <span className="tel-label">Tỷ lệ Dài / Rộng</span>
                    <strong className="tel-val">{faceMetrics.ratio} : 1</strong>
                    <div className="tel-bar-wrap">
                      <div className="tel-bar-fill" style={{ width: `${Math.min(100, (faceMetrics.ratio / 1.6) * 100)}%` }} />
                    </div>
                    <small className="tel-hint">{faceMetrics.ratio > 1.36 ? 'Dáng thon dài (Oval)' : 'Dáng tròn / vuông'}</small>
                  </div>

                  <div className="telemetry-item">
                    <span className="tel-label">Độ rộng Trán</span>
                    <strong className="tel-val">{faceMetrics.foreheadRatio}%</strong>
                    <div className="tel-bar-wrap">
                      <div className="tel-bar-fill" style={{ width: `${Math.min(100, faceMetrics.foreheadRatio)}%` }} />
                    </div>
                    <small className="tel-hint">So với gò má</small>
                  </div>

                  <div className="telemetry-item">
                    <span className="tel-label">Độ rộng Xương Hàm</span>
                    <strong className="tel-val">{faceMetrics.jawRatio}%</strong>
                    <div className="tel-bar-wrap">
                      <div className="tel-bar-fill" style={{ width: `${Math.min(100, faceMetrics.jawRatio)}%` }} />
                    </div>
                    <small className="tel-hint">{faceMetrics.jawRatio > 82 ? 'Góc hàm vuông vức' : 'Góc hàm bo mềm'}</small>
                  </div>

                  <div className="telemetry-item">
                    <span className="tel-label">Góc Cằm (V-Factor)</span>
                    <strong className="tel-val">{faceMetrics.chinAngle}°</strong>
                    <div className="tel-bar-wrap">
                      <div className="tel-bar-fill" style={{ width: `${Math.min(100, (faceMetrics.chinAngle / 90) * 100)}%` }} />
                    </div>
                    <small className="tel-hint">Độ thon cằm V-line</small>
                  </div>
                </div>
              </div>

              {/* Dynamic Compatibility Score Breakdown */}
              <div
                className="diag-match-score-box"
                style={{
                  borderColor: currentMatchAnalysis.badgeColor,
                  background: `linear-gradient(135deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.08) 40%, rgba(12, 17, 28, 0.45) 100%)`
                }}
              >
                <div className="score-circle-badge" style={{ borderColor: currentMatchAnalysis.badgeColor, color: currentMatchAnalysis.badgeColor }}>
                  <span className="score-num">{currentMatchAnalysis.score === null ? '—' : `${currentMatchAnalysis.score}%`}</span>
                  <small className="score-lbl">ĐỘ HỢP</small>
                </div>
                <div className="score-details-col">
                  <div className="score-badge-row">
                    <span
                      className="score-tier-pill"
                      style={{
                        color: currentMatchAnalysis.badgeColor,
                        backgroundColor: currentMatchAnalysis.badgeBg,
                        borderColor: currentMatchAnalysis.badgeColor
                      }}
                    >
                      {currentMatchAnalysis.badgeLabel}
                    </span>
                    <span className="score-face-shape-tag">
                      Dáng mặt: <strong>
                        {currentFaceShape === 'oval' ? 'Trái Xoan' :
                          currentFaceShape === 'round' ? 'Mặt Tròn' :
                            currentFaceShape === 'square' ? 'Mặt Vuông' :
                              currentFaceShape === 'heart' ? 'Trái Tim' : 'Kim Cương'}
                      </strong>
                    </span>
                  </div>
                  <h4 className="score-title">
                    {selectedGlasses ? `${selectedGlasses.brand} ${selectedGlasses.name}` : 'Chưa chọn kính'}
                  </h4>
                  <p className="score-reason-text">
                    {currentMatchAnalysis.reason}
                  </p>
                  <div className="score-tip-pill">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span><strong>Lời khuyên Bác sĩ:</strong> {currentMatchAnalysis.tip}</span>
                  </div>
                </div>
              </div>

              {/* Optical Harmony Guide */}
              <div className="diag-guide-box">
                <h5 className="guide-title">BÍ QUYẾT CHỌN GỌNG TỪ CHUYÊN GIA KHÚC XẠ:</h5>
                <div className="guide-grid">
                  <div className="guide-item">
                    <span className="guide-shape">Mặt Tròn:</span>
                    <span className="guide-desc">Chọn gọng <strong>Vuông / Đa Giác</strong> để tạo góc cạnh thon gọn.</span>
                  </div>
                  <div className="guide-item">
                    <span className="guide-shape">Mặt Vuông:</span>
                    <span className="guide-desc">Chọn gọng <strong>Tròn / Oval / Phi Công</strong> để làm mềm quai hàm.</span>
                  </div>
                  <div className="guide-item">
                    <span className="guide-shape">Trái Xoan:</span>
                    <span className="guide-desc">Tỷ lệ vàng, hợp tuyệt đẹp với hầu hết mọi dáng kính thời trang.</span>
                  </div>
                  <div className="guide-item">
                    <span className="guide-shape">Trái Tim:</span>
                    <span className="guide-desc">Chọn gọng <strong>Khoan Không Viền / Phi Công</strong> để cân đối cằm.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="diag-footer-lux">
              <button
                type="button"
                onClick={() => setShowDiagnosisModal(false)}
                className="diag-confirm-btn flex items-center justify-center gap-1.5"
              >
                <span>Đã Hiểu & Tiếp Tục Thử Kính</span>
                <Sparkles className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7.5 INTERACTIVE 3D MODEL 360° INSPECTOR MODAL */}
      {is3DViewerOpen && selectedGlasses && (
        <Interactive3DViewerModal
          glasses={selectedGlasses}
          selectedColorIdx={selectedColorIdx}
          onSelectColor={setSelectedColorIdx}
          onClose={() => setIs3DViewerOpen(false)}
          onTryOnNow={() => {
            setIs3DViewerOpen(false);
            if (!isCameraActive && !uploadedPhotoUrl) void startCamera('user');
          }}
          onBookNow={() => {
            setIs3DViewerOpen(false);
            handleSelectCurrentFrame();
          }}
        />
      )}

      {/* 8. IN-APP DIRECT BOOKING MODAL (NO REDIRECT TO HOME) */}
      {isBookingModalOpen && (
        <div className="ar-booking-modal-overlay" onClick={() => setIsBookingModalOpen(false)}>
          <div className="ar-booking-card luxury-modal-glow" onClick={e => e.stopPropagation()}>
            <div className="diag-header-lux">
              <div className="diag-header-titles">
                <span className="diag-badge-gold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>LÊ QUỲNH OPTIC • ĐẶT LỊCH TRỰC TIẾP</span>
                </span>
                <h3 className="diag-main-title">
                  {bookingSuccessResult ? 'Xác Nhận Lịch Hẹn Thành Công' : 'Đặt Lịch Giữ Mẫu Kính & Khám Mắt Miễn Phí'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsBookingModalOpen(false);
                  setBookingSuccessResult(null);
                }}
                className="diag-close-lux"
                title="Đóng bảng đặt lịch"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* If Successful Booking: Show VIP Pass */}
            {bookingSuccessResult ? (
              <div className="ar-booking-success-body">
                <div className="booking-pass-card">
                  <div className="pass-top-bar">
                    <span className="pass-brand">LÊ QUỲNH OPTIC VIP PASS</span>
                    <span className="pass-code">MÃ: {bookingSuccessResult.data?.appointmentCode || 'LQ-VIP'}</span>
                  </div>

                  <div className="pass-content-grid">
                    <div className="pass-info-col">
                      <div className="pass-item">
                        <span className="pass-lbl">Khách hàng:</span>
                        <strong className="pass-val">{bookingFormData.fullName}</strong>
                      </div>
                      <div className="pass-item">
                        <span className="pass-lbl">Số điện thoại:</span>
                        <strong className="pass-val">{bookingFormData.phone}</strong>
                      </div>
                      <div className="pass-item">
                        <span className="pass-lbl">Thời gian hẹn:</span>
                        <strong className="pass-val text-gold">{bookingFormData.appointmentTime} • Ngày {new Date(bookingFormData.appointmentDate).toLocaleDateString('vi-VN')}</strong>
                      </div>
                      <div className="pass-item">
                        <span className="pass-lbl">Địa chỉ khám:</span>
                        <strong className="pass-val">380B Nguyễn Doãn Chấp, TP. Thanh Hóa</strong>
                      </div>
                    </div>

                    <div className="pass-frame-col">
                      <div className="pass-frame-svg">
                        {selectedGlasses ? renderRealisticGlassesSVG(selectedGlasses, selectedColorIdx) : null}
                      </div>
                      <span className="pass-frame-name">{selectedGlasses?.brand} {selectedGlasses?.name}</span>
                      <span className="pass-frame-color">Màu: {selectedGlasses?.colors[selectedColorIdx]?.name}</span>
                      <span className="pass-frame-promo flex items-center gap-1 justify-center">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>Đã áp dụng -10% Ưu Đãi Online</span>
                      </span>
                    </div>
                  </div>

                  <div className="pass-footer-notes">
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Miễn phí 100% quy trình đo khám mắt 12 bước chuẩn quốc tế.</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Kính đã được nhân viên chuẩn bị sẵn sàng trước giờ hẹn của bạn.</span>
                    </span>
                  </div>
                </div>

                <div className="success-action-row">
                  <button
                    type="button"
                    onClick={() => {
                      setIsBookingModalOpen(false);
                      setBookingSuccessResult(null);
                    }}
                    className="pass-continue-btn flex items-center justify-center gap-1.5"
                  >
                    <Glasses className="w-4 h-4" />
                    <span>Tiếp Tục Thử Mẫu Kính Khác</span>
                  </button>
                  <Link href="/" className="pass-home-btn flex items-center justify-center gap-1.5">
                    <span>Về Trang Chủ</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ) : (
              /* If Booking Form: Show Input Form with Selected Glasses Summary */
              <form onSubmit={handleDirectBookingSubmit} className="ar-booking-form-body">
                {/* Selected Frame & Try-On Photo Highlight */}
                {selectedGlasses && (
                  <div className="booking-selected-frame-box">
                    {capturedPhoto ? (
                      <div className="frame-box-live-photo" title="Ảnh thử kính thực tế của bạn">
                        <img src={capturedPhoto} alt="Tryon Photo" className="box-photo-thumb" />
                      </div>
                    ) : (
                      <div className="frame-box-svg">
                        {renderRealisticGlassesSVG(selectedGlasses, selectedColorIdx)}
                      </div>
                    )}
                    <div className="frame-box-info">
                      <div className="frame-tag-row">
                        <span className="frame-brand-tag">{selectedGlasses.brand}</span>
                        <span className="frame-match-tag" style={{ color: currentMatchAnalysis.badgeColor, backgroundColor: currentMatchAnalysis.badgeBg }}>
                          {currentMatchAnalysis.badgeLabel}
                        </span>
                      </div>
                      <h4 className="frame-box-title">{selectedGlasses.name}</h4>
                      <div className="frame-box-price-row">
                        <span className="frame-box-price">{selectedGlasses.price}</span>
                        <span className="frame-box-color">Màu: {selectedGlasses.colors[selectedColorIdx]?.name}</span>
                      </div>
                      <span className="frame-attached-hint flex items-center gap-1">
                        <Camera className="w-3.5 h-3.5 text-amber-400" />
                        <span>{capturedPhoto ? 'Đã đính kèm ảnh thử kính vào hồ sơ Bác sĩ' : 'Đã lưu mẫu kính vào hồ sơ khám'}</span>
                      </span>
                    </div>
                  </div>
                )}

                {bookingError && (
                  <div className="ar-booking-error-banner">
                    ⚠️ {bookingError}
                  </div>
                )}

                {/* Patient Input Fields */}
                <div className="ar-booking-inputs-grid">
                  <div className="ar-input-group">
                    <label className="ar-input-label">Họ và tên bệnh nhân <span className="req">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="Ví dụ: Nguyễn Văn An"
                      value={bookingFormData.fullName}
                      onChange={e => setBookingFormData({ ...bookingFormData, fullName: e.target.value })}
                      className="ar-text-input"
                    />
                  </div>

                  <div className="ar-input-group">
                    <label className="ar-input-label">Số điện thoại liên hệ <span className="req">*</span></label>
                    <input
                      type="tel"
                      required
                      placeholder="Ví dụ: 0989 123 456"
                      value={bookingFormData.phone}
                      onChange={e => setBookingFormData({ ...bookingFormData, phone: e.target.value })}
                      className="ar-text-input"
                    />
                  </div>

                  <div className="ar-input-group">
                    <label className="ar-input-label">Ngày hẹn khám <span className="req">*</span></label>
                    <input
                      type="date"
                      required
                      min={new Date().toISOString().split('T')[0]}
                      value={bookingFormData.appointmentDate}
                      onChange={e => setBookingFormData({ ...bookingFormData, appointmentDate: e.target.value })}
                      className="ar-text-input"
                    />
                  </div>

                  <div className="ar-input-group">
                    <label className="ar-input-label">Giờ hẹn khám <span className="req">*</span></label>
                    <input
                      type="time"
                      required
                      value={bookingFormData.appointmentTime}
                      onChange={e => setBookingFormData({ ...bookingFormData, appointmentTime: e.target.value })}
                      className="ar-text-input"
                    />
                  </div>
                </div>

                {/* Quick Time Picker Chips */}
                <div className="ar-quick-time-chips">
                  <span className="chips-lbl">Khung giờ nhanh:</span>
                  {['08:30', '09:30', '10:30', '14:30', '16:00', '17:30', '19:00'].map(t => (
                    <button
                      key={t}
                      type="button"
                      className={`time-chip ${bookingFormData.appointmentTime === t ? 'active' : ''}`}
                      onClick={() => setBookingFormData({ ...bookingFormData, appointmentTime: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Notes Input - pre-filled with selected glasses frame */}
                <div className="ar-input-group full-width">
                  <label className="ar-input-label">
                    <span className="flex items-center gap-1.5">
                      <Glasses className="w-3.5 h-3.5 text-amber-400" />
                      <span>Mẫu gọng kính đã chọn & Ghi chú thêm:</span>
                    </span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Mẫu gọng kính đã chọn và yêu cầu thêm cho Bác sĩ..."
                    value={bookingFormData.notes}
                    onChange={e => setBookingFormData({ ...bookingFormData, notes: e.target.value })}
                    className="ar-text-input ar-textarea-input"
                  />
                </div>

                {/* Submit Action Button */}
                <div className="ar-booking-footer-btn-row">
                  <button
                    type="submit"
                    disabled={isSubmittingBooking}
                    className="ar-submit-booking-btn flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 fill-slate-950 text-slate-950" />
                    <span>{isSubmittingBooking ? 'Đang Lưu Lịch Hẹn...' : 'XÁC NHẬN ĐẶT LỊCH (GIỮ MẪU & -10%)'}</span>
                    {!isSubmittingBooking && <ArrowRight className="w-4 h-4" />}
                  </button>
                  <small className="ar-booking-privacy-hint flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Cam kết bảo mật thông tin • Bác sĩ sẽ gọi điện xác nhận trong 5 phút</span>
                  </small>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
