/// Visual Shop marketplace: sellers list eyewear (one media file hosted off-chain, referenced by
/// URL), buyers pay in SUI and receive a Receipt object as proof of purchase.
module visual_shop::marketplace;

use std::string::String;
use sui::coin::Coin;
use sui::event;
use sui::sui::SUI;

const ENotSeller: u64 = 0;
const EWrongPayment: u64 = 1;
const EOutOfStock: u64 = 2;
const EInactive: u64 = 3;
const EInvalidPrice: u64 = 4;
const EInvalidStatus: u64 = 5;

/// Listing lifecycle. Stored as u8 so more states can be added without changing the layout.
const STATUS_ACTIVE: u8 = 0;
const STATUS_CLOSED: u8 = 1;

/// Shared registry of every listing ID, so the frontend can load the catalog with one read.
public struct Shop has key {
    id: UID,
    listings: vector<ID>,
}

/// One product for sale. Shared so any buyer can call `buy`.
public struct Listing has key {
    id: UID,
    seller: address,
    title: String,
    description: String,
    /// Price in MIST (1 SUI = 1_000_000_000 MIST).
    price: u64,
    stock: u64,
    sold: u64,
    /// `STATUS_ACTIVE` (0) or `STATUS_CLOSED` (1); only active listings can be bought.
    status: u8,
    /// Link to the product media (png, jpg, webp, svg, glb, ...).
    image_url: String,
    /// File format of `image_url` ("png", "svg", "glb", ...); tells the UI how to render it.
    image_type: String,
}

/// Owned by the buyer after a purchase.
public struct Receipt has key, store {
    id: UID,
    listing_id: ID,
    seller: address,
    buyer: address,
    price: u64,
    title: String,
    image_url: String,
    image_type: String,
}

public struct ListingCreated has copy, drop {
    listing_id: ID,
    seller: address,
    price: u64,
}

public struct ListingUpdated has copy, drop {
    listing_id: ID,
    price: u64,
    stock: u64,
    status: u8,
}

public struct Purchased has copy, drop {
    listing_id: ID,
    receipt_id: ID,
    buyer: address,
    seller: address,
    price: u64,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(Shop { id: object::new(ctx), listings: vector[] });
}

// === Sell ===

public fun create_listing(
    shop: &mut Shop,
    title: String,
    description: String,
    price: u64,
    stock: u64,
    image_url: String,
    image_type: String,
    ctx: &mut TxContext,
): ID {
    assert!(price > 0, EInvalidPrice);
    let listing = Listing {
        id: object::new(ctx),
        seller: ctx.sender(),
        title,
        description,
        price,
        stock,
        sold: 0,
        status: STATUS_ACTIVE,
        image_url,
        image_type,
    };
    let listing_id = object::id(&listing);
    shop.listings.push_back(listing_id);
    event::emit(ListingCreated { listing_id, seller: listing.seller, price });
    transfer::share_object(listing);
    listing_id
}

public fun update_listing(
    listing: &mut Listing,
    price: u64,
    stock: u64,
    status: u8,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == listing.seller, ENotSeller);
    assert!(price > 0, EInvalidPrice);
    assert!(status == STATUS_ACTIVE || status == STATUS_CLOSED, EInvalidStatus);
    listing.price = price;
    listing.stock = stock;
    listing.status = status;
    event::emit(ListingUpdated { listing_id: object::id(listing), price, stock, status });
}

// === Buy ===

/// Pays the seller and returns a Receipt. `payment` must equal `price` exactly;
/// the caller splits it from gas and transfers the Receipt to themselves in the same PTB.
public fun buy(listing: &mut Listing, payment: Coin<SUI>, ctx: &mut TxContext): Receipt {
    assert!(listing.status == STATUS_ACTIVE, EInactive);
    assert!(listing.stock > 0, EOutOfStock);
    assert!(payment.value() == listing.price, EWrongPayment);

    listing.stock = listing.stock - 1;
    listing.sold = listing.sold + 1;
    transfer::public_transfer(payment, listing.seller);

    let receipt = Receipt {
        id: object::new(ctx),
        listing_id: object::id(listing),
        seller: listing.seller,
        buyer: ctx.sender(),
        price: listing.price,
        title: listing.title,
        image_url: listing.image_url,
        image_type: listing.image_type,
    };
    event::emit(Purchased {
        listing_id: receipt.listing_id,
        receipt_id: object::id(&receipt),
        buyer: receipt.buyer,
        seller: receipt.seller,
        price: receipt.price,
    });
    receipt
}

// === Getters ===

public fun listing_ids(shop: &Shop): &vector<ID> { &shop.listings }

public fun price(listing: &Listing): u64 { listing.price }

public fun stock(listing: &Listing): u64 { listing.stock }

public fun sold(listing: &Listing): u64 { listing.sold }

public fun seller(listing: &Listing): address { listing.seller }

public fun status(listing: &Listing): u8 { listing.status }

public fun image_url(listing: &Listing): String { listing.image_url }

public fun image_type(listing: &Listing): String { listing.image_type }

public fun status_active(): u8 { STATUS_ACTIVE }

public fun status_closed(): u8 { STATUS_CLOSED }

public fun receipt_listing_id(receipt: &Receipt): ID { receipt.listing_id }

public fun receipt_buyer(receipt: &Receipt): address { receipt.buyer }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
