import { bcs } from '@mysten/sui/bcs'
import { describe, expect, it } from 'vitest'
import { LISTING_STATUS } from '@/types'
import { createListingTx, decodeListing, decodeReceipt, updateListingTx } from './marketplace'

const ADDR = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

// Same field order as `Listing` / `Receipt` in move/sources/marketplace.move.
const listingBytes = bcs
  .struct('Listing', {
    id: bcs.Address,
    seller: bcs.Address,
    title: bcs.string(),
    description: bcs.string(),
    price: bcs.u64(),
    stock: bcs.u64(),
    sold: bcs.u64(),
    status: bcs.u8(),
    image_url: bcs.string(),
    image_type: bcs.string(),
  })
  .serialize({
    id: ADDR(1),
    seller: ADDR(2),
    title: 'Round Tortoise',
    description: 'Acetate frame',
    price: 100_000_000n,
    stock: 5n,
    sold: 1n,
    status: LISTING_STATUS.closed,
    image_url: 'https://res.cloudinary.com/demo/raw/upload/frame.glb',
    image_type: 'glb',
  })
  .toBytes()

const receiptBytes = bcs
  .struct('Receipt', {
    id: bcs.Address,
    listing_id: bcs.Address,
    seller: bcs.Address,
    buyer: bcs.Address,
    price: bcs.u64(),
    title: bcs.string(),
    image_url: bcs.string(),
    image_type: bcs.string(),
  })
  .serialize({
    id: ADDR(3),
    listing_id: ADDR(1),
    seller: ADDR(2),
    buyer: ADDR(4),
    price: 100_000_000n,
    title: 'Round Tortoise',
    image_url: 'https://res.cloudinary.com/demo/image/upload/frame.png',
    image_type: 'png',
  })
  .toBytes()

describe('marketplace SDK', () => {
  it('decodes a Listing with status, imageUrl and imageType', () => {
    expect(decodeListing(listingBytes)).toEqual({
      id: ADDR(1),
      seller: ADDR(2),
      title: 'Round Tortoise',
      description: 'Acetate frame',
      price: 100_000_000n,
      stock: 5,
      sold: 1,
      status: LISTING_STATUS.closed,
      imageUrl: 'https://res.cloudinary.com/demo/raw/upload/frame.glb',
      imageType: 'glb',
    })
  })

  it('decodes a Receipt with imageUrl and imageType', () => {
    expect(decodeReceipt(receiptBytes)).toMatchObject({
      listingId: ADDR(1),
      buyer: ADDR(4),
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/frame.png',
      imageType: 'png',
    })
  })

  it('builds create_listing and update_listing calls with the new arguments', () => {
    const create = createListingTx({
      title: 't',
      description: 'd',
      priceMist: 1n,
      stock: 2,
      imageUrl: 'https://x/y.png',
      imageType: 'png',
    }).getData()
    expect(create.commands[0].MoveCall?.function).toBe('create_listing')
    expect(create.commands[0].MoveCall?.arguments).toHaveLength(7)

    const update = updateListingTx(ADDR(1), 1n, 2, LISTING_STATUS.closed).getData()
    expect(update.commands[0].MoveCall?.function).toBe('update_listing')
    expect(update.inputs.some((i) => i.Pure?.bytes === 'AQ==')).toBe(true)
  })
})
