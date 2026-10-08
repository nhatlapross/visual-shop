/// Visual Shop marketplace: sellers list eyewear (photo + 3D model stored on Walrus),
/// buyers pay in SUI and receive a Receipt object as proof of purchase.
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
    /// Walrus blob ID of the product photo.
    image_blob_id: String,
    /// Walrus blob ID of the GLB model used by the viewer and try-on.
    model_blob_id: String,
    active: bool,
}

/// Owned by the buyer after a purchase.
public struct Receipt has key, store {
    id: UID,
    listing_id: ID,
    seller: address,
    buyer: address,
    price: u64,
    title: String,
    image_blob_id: String,
    model_blob_id: String,
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
    active: bool,
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

public fun create_listing(
    shop: &mut Shop,
    title: String,
    description: String,
    price: u64,
    stock: u64,
    image_blob_id: String,
    model_blob_id: String,
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
        image_blob_id,
        model_blob_id,
        active: true,
    };
    let listing_id = object::id(&listing);
    shop.listings.push_back(listing_id);
    event::emit(ListingCreated { listing_id, seller: listing.seller, price });
    transfer::share_object(listing);
    listing_id
}

/// Pays the seller and returns a Receipt. `payment` must equal `price` exactly;
/// the caller splits it from gas and transfers the Receipt to themselves in the same PTB.
public fun buy(listing: &mut Listing, payment: Coin<SUI>, ctx: &mut TxContext): Receipt {
    assert!(listing.active, EInactive);
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
        image_blob_id: listing.image_blob_id,
        model_blob_id: listing.model_blob_id,
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

public fun update_listing(
    listing: &mut Listing,
    price: u64,
    stock: u64,
    active: bool,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == listing.seller, ENotSeller);
    assert!(price > 0, EInvalidPrice);
    listing.price = price;
    listing.stock = stock;
    listing.active = active;
    event::emit(ListingUpdated { listing_id: object::id(listing), price, stock, active });
}

// === Getters ===

public fun listing_ids(shop: &Shop): &vector<ID> { &shop.listings }

public fun price(listing: &Listing): u64 { listing.price }

public fun stock(listing: &Listing): u64 { listing.stock }

public fun sold(listing: &Listing): u64 { listing.sold }

public fun seller(listing: &Listing): address { listing.seller }

public fun is_active(listing: &Listing): bool { listing.active }

public fun receipt_listing_id(receipt: &Receipt): ID { receipt.listing_id }

public fun receipt_buyer(receipt: &Receipt): address { receipt.buyer }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
