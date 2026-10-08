import { modelUrl, thumbnailUrl } from './media'

const glb = 'https://res.cloudinary.com/demo/image/upload/v1/visual-shop/catalog/frame-1.glb'

test('Cloudinary GLB gets a rendered PNG thumbnail', () => {
  expect(thumbnailUrl(glb, 'glb', 400)).toBe(
    'https://res.cloudinary.com/demo/image/upload/w_400,h_400,c_pad,b_white/v1/visual-shop/catalog/frame-1.png',
  )
})

test('images are their own thumbnail; GLBs elsewhere have none', () => {
  expect(thumbnailUrl('https://x.test/a.png', 'png')).toBe('https://x.test/a.png')
  expect(thumbnailUrl('https://x.test/a.glb', 'glb')).toBe('')
})

test('only GLB media is a model', () => {
  expect(modelUrl(glb, 'glb')).toBe(glb)
  expect(modelUrl('https://x.test/a.png', 'png')).toBe('')
})
