import { modelUrl, thumbnailUrl } from './media'

const glb = 'https://res.cloudinary.com/demo/image/upload/v1/visual-shop/catalog/frame-1.glb'
const base = 'https://res.cloudinary.com/demo/image/upload/'

test('Cloudinary GLB renders to a trimmed transparent PNG', () => {
  expect(thumbnailUrl(glb, 'glb', 400)).toBe(`${base}e_trim/w_400,c_fit/v1/visual-shop/catalog/frame-1.png`)
})

test('images are their own thumbnail; GLBs elsewhere have none', () => {
  expect(thumbnailUrl('https://x.test/a.png', 'png', 400)).toBe('https://x.test/a.png')
  expect(thumbnailUrl('https://x.test/a.glb', 'glb')).toBe('')
})

test('only GLB media is a model', () => {
  expect(modelUrl(glb, 'glb')).toBe(glb)
  expect(modelUrl('https://x.test/a.png', 'png')).toBe('')
})
