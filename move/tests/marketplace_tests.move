#[test_only]
module visual_shop::marketplace_tests;

use std::unit_test::assert_eq;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use visual_shop::marketplace::{Self, Shop, Listing, Receipt};

const SELLER: address = @0xA;
const BUYER: address = @0xB;
const PRICE: u64 = 2_000_000_000;

fun setup_listing(scenario: &mut Scenario, stock: u64) {
    marketplace::init_for_testing(scenario.ctx());
    scenario.next_tx(SELLER);
    let mut shop = scenario.take_shared<Shop>();
    marketplace::create_listing(
        &mut shop,
        b"Round Tortoise".to_string(),
        b"Acetate frame".to_string(),
        PRICE,
        stock,
        b"https://res.cloudinary.com/demo/image/upload/frame.glb".to_string(),
        b"glb".to_string(),
        scenario.ctx(),
    );
    assert_eq!(shop.listing_ids().length(), 1);
    ts::return_shared(shop);
}

fun pay(scenario: &mut Scenario, amount: u64): Coin<SUI> {
    coin::mint_for_testing<SUI>(amount, scenario.ctx())
}

#[test]
fun buy_pays_seller_and_issues_receipt() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 2);

    scenario.next_tx(BUYER);
    let mut listing = scenario.take_shared<Listing>();
    let payment = pay(&mut scenario, PRICE);
    let receipt = marketplace::buy(&mut listing, payment, scenario.ctx());
    assert_eq!(receipt.receipt_buyer(), BUYER);
    assert_eq!(receipt.receipt_listing_id(), object::id(&listing));
    assert_eq!(listing.stock(), 1);
    assert_eq!(listing.sold(), 1);
    transfer::public_transfer(receipt, BUYER);
    ts::return_shared(listing);

    scenario.next_tx(SELLER);
    let earned = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(earned.value(), PRICE);
    scenario.return_to_sender(earned);

    scenario.next_tx(BUYER);
    assert!(scenario.has_most_recent_for_sender<Receipt>());
    scenario.end();
}

#[test, expected_failure(abort_code = marketplace::EWrongPayment)]
fun buy_rejects_wrong_amount() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 1);
    scenario.next_tx(BUYER);
    let mut listing = scenario.take_shared<Listing>();
    let payment = pay(&mut scenario, PRICE - 1);
    let receipt = marketplace::buy(&mut listing, payment, scenario.ctx());
    transfer::public_transfer(receipt, BUYER);
    ts::return_shared(listing);
    scenario.end();
}

#[test, expected_failure(abort_code = marketplace::EOutOfStock)]
fun buy_rejects_when_sold_out() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 0);
    scenario.next_tx(BUYER);
    let mut listing = scenario.take_shared<Listing>();
    let payment = pay(&mut scenario, PRICE);
    let receipt = marketplace::buy(&mut listing, payment, scenario.ctx());
    transfer::public_transfer(receipt, BUYER);
    ts::return_shared(listing);
    scenario.end();
}

#[test, expected_failure(abort_code = marketplace::EInactive)]
fun buy_rejects_inactive_listing() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 1);
    scenario.next_tx(SELLER);
    let mut listing = scenario.take_shared<Listing>();
    marketplace::update_listing(&mut listing, PRICE, 1, marketplace::status_closed(), scenario.ctx());
    ts::return_shared(listing);

    scenario.next_tx(BUYER);
    let mut listing = scenario.take_shared<Listing>();
    let payment = pay(&mut scenario, PRICE);
    let receipt = marketplace::buy(&mut listing, payment, scenario.ctx());
    transfer::public_transfer(receipt, BUYER);
    ts::return_shared(listing);
    scenario.end();
}

#[test, expected_failure(abort_code = marketplace::ENotSeller)]
fun only_seller_can_update() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 1);
    scenario.next_tx(BUYER);
    let mut listing = scenario.take_shared<Listing>();
    marketplace::update_listing(&mut listing, 1, 1, marketplace::status_active(), scenario.ctx());
    ts::return_shared(listing);
    scenario.end();
}

#[test]
fun create_listing_stores_media_and_starts_active() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 3);
    scenario.next_tx(BUYER);
    let listing = scenario.take_shared<Listing>();
    assert_eq!(listing.status(), marketplace::status_active());
    assert_eq!(listing.image_url(), b"https://res.cloudinary.com/demo/image/upload/frame.glb".to_string());
    assert_eq!(listing.image_type(), b"glb".to_string());
    ts::return_shared(listing);
    scenario.end();
}

#[test]
fun seller_can_close_and_reopen() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 1);
    scenario.next_tx(SELLER);
    let mut listing = scenario.take_shared<Listing>();
    marketplace::update_listing(&mut listing, PRICE, 1, marketplace::status_closed(), scenario.ctx());
    assert_eq!(listing.status(), marketplace::status_closed());
    marketplace::update_listing(&mut listing, PRICE, 1, marketplace::status_active(), scenario.ctx());
    assert_eq!(listing.status(), marketplace::status_active());
    ts::return_shared(listing);
    scenario.end();
}

#[test, expected_failure(abort_code = marketplace::EInvalidStatus)]
fun update_rejects_unknown_status() {
    let mut scenario = ts::begin(SELLER);
    setup_listing(&mut scenario, 1);
    scenario.next_tx(SELLER);
    let mut listing = scenario.take_shared<Listing>();
    marketplace::update_listing(&mut listing, PRICE, 1, 2, scenario.ctx());
    ts::return_shared(listing);
    scenario.end();
}
