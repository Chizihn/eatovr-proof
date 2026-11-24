use super::*;
use soroban_sdk::testutils::Address as _;

fn setup() -> (Env, AttestationRegistryClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AttestationRegistry, ());
    let client = AttestationRegistryClient::new(&env, &contract_id);

    let vendor = Address::generate(&env);
    let recipient = Address::generate(&env);

    (env, client, vendor, recipient)
}

#[test]
fn full_two_party_flow_finalizes() {
    let (env, client, vendor, recipient) = setup();
    let order_id = String::from_str(&env, "order-rice-and-stew-001");
    let item_type = String::from_str(&env, "rice_and_stew_trays");

    client.claim_pickup(&order_id, &vendor, &recipient, &item_type, &12u32);

    let pending = client.get_claim(&order_id);
    assert_eq!(pending.status, ClaimStatus::Pending);
    assert_eq!(pending.confirmed_at, 0);

    client.confirm_pickup(&order_id, &recipient);

    let finalized = client.get_claim(&order_id);
    assert_eq!(finalized.status, ClaimStatus::Finalized);
    assert!(finalized.confirmed_at >= finalized.claimed_at);
}

#[test]
fn confirm_by_wrong_recipient_fails() {
    let (env, client, vendor, recipient) = setup();
    let other = Address::generate(&env);
    let order_id = String::from_str(&env, "order-bread-001");
    let item_type = String::from_str(&env, "bread_loaves");

    client.claim_pickup(&order_id, &vendor, &recipient, &item_type, &5u32);

    let result = client.try_confirm_pickup(&order_id, &other);
    assert_eq!(result, Err(Ok(Error::RecipientMismatch)));
}

#[test]
fn double_confirm_fails() {
    let (env, client, vendor, recipient) = setup();
    let order_id = String::from_str(&env, "order-pastries-001");
    let item_type = String::from_str(&env, "pastries");

    client.claim_pickup(&order_id, &vendor, &recipient, &item_type, &3u32);
    client.confirm_pickup(&order_id, &recipient);

    let result = client.try_confirm_pickup(&order_id, &recipient);
    assert_eq!(result, Err(Ok(Error::AlreadyFinalized)));
}

#[test]
fn vendor_cannot_claim_for_self() {
    let (env, client, vendor, _recipient) = setup();
    let order_id = String::from_str(&env, "order-jollof-001");
    let item_type = String::from_str(&env, "jollof");

    let result = client.try_claim_pickup(&order_id, &vendor, &vendor, &item_type, &1u32);
    assert_eq!(result, Err(Ok(Error::VendorIsRecipient)));
}

#[test]
fn zero_quantity_rejected() {
    let (env, client, vendor, recipient) = setup();
    let order_id = String::from_str(&env, "order-suya-001");
    let item_type = String::from_str(&env, "suya");

    let result = client.try_claim_pickup(&order_id, &vendor, &recipient, &item_type, &0u32);
    assert_eq!(result, Err(Ok(Error::ZeroQuantity)));
}

#[test]
fn claiming_same_order_twice_fails() {
    let (env, client, vendor, recipient) = setup();
    let order_id = String::from_str(&env, "order-moi-moi-001");
    let item_type = String::from_str(&env, "moi_moi");

    client.claim_pickup(&order_id, &vendor, &recipient, &item_type, &2u32);

    let result = client.try_claim_pickup(&order_id, &vendor, &recipient, &item_type, &2u32);
    assert_eq!(result, Err(Ok(Error::ClaimAlreadyExists)));
}

#[test]
fn confirming_unknown_claim_fails() {
    let (env, client, _vendor, recipient) = setup();
    let order_id = String::from_str(&env, "order-never-claimed-001");

    let result = client.try_confirm_pickup(&order_id, &recipient);
    assert_eq!(result, Err(Ok(Error::ClaimNotFound)));
}

/// The whole point of keying by `order_id`: `confirm_pickup`'s
/// authorization entry only needs `order_id` and `recipient`, both
/// known at checkout time — well before the vendor ever calls
/// `claim_pickup`. This test proves that holds even when confirm is
/// attempted (and correctly rejected) before the claim exists, then
/// succeeds once it does — i.e. the *signature* for confirm_pickup
/// could have been produced at any point before this, and this
/// contract call is what actually gates finalization on claim order,
/// not when the recipient signed.
#[test]
fn confirm_can_be_attempted_before_claim_and_succeed_after() {
    let (env, client, vendor, recipient) = setup();
    let order_id = String::from_str(&env, "order-akara-001");
    let item_type = String::from_str(&env, "akara");

    let early_attempt = client.try_confirm_pickup(&order_id, &recipient);
    assert_eq!(early_attempt, Err(Ok(Error::ClaimNotFound)));

    client.claim_pickup(&order_id, &vendor, &recipient, &item_type, &4u32);
    client.confirm_pickup(&order_id, &recipient);

    let finalized = client.get_claim(&order_id);
    assert_eq!(finalized.status, ClaimStatus::Finalized);
}
