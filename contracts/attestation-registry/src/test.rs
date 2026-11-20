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
    let item_type = String::from_str(&env, "rice_and_stew_trays");

    let claim_id = client.claim_pickup(&vendor, &recipient, &item_type, &12u32);

    let pending = client.get_claim(&claim_id);
    assert_eq!(pending.status, ClaimStatus::Pending);
    assert_eq!(pending.confirmed_at, 0);

    client.confirm_pickup(&claim_id, &recipient);

    let finalized = client.get_claim(&claim_id);
    assert_eq!(finalized.status, ClaimStatus::Finalized);
    assert!(finalized.confirmed_at >= finalized.claimed_at);
}

#[test]
fn confirm_by_wrong_recipient_fails() {
    let (env, client, vendor, recipient) = setup();
    let other = Address::generate(&env);
    let item_type = String::from_str(&env, "bread_loaves");

    let claim_id = client.claim_pickup(&vendor, &recipient, &item_type, &5u32);

    let result = client.try_confirm_pickup(&claim_id, &other);
    assert_eq!(result, Err(Ok(Error::RecipientMismatch)));
}

#[test]
fn double_confirm_fails() {
    let (env, client, vendor, recipient) = setup();
    let item_type = String::from_str(&env, "pastries");

    let claim_id = client.claim_pickup(&vendor, &recipient, &item_type, &3u32);
    client.confirm_pickup(&claim_id, &recipient);

    let result = client.try_confirm_pickup(&claim_id, &recipient);
    assert_eq!(result, Err(Ok(Error::AlreadyFinalized)));
}

#[test]
fn vendor_cannot_claim_for_self() {
    let (env, client, vendor, _recipient) = setup();
    let item_type = String::from_str(&env, "jollof");

    let result = client.try_claim_pickup(&vendor, &vendor, &item_type, &1u32);
    assert_eq!(result, Err(Ok(Error::VendorIsRecipient)));
}

#[test]
fn zero_quantity_rejected() {
    let (env, client, vendor, recipient) = setup();
    let item_type = String::from_str(&env, "suya");

    let result = client.try_claim_pickup(&vendor, &recipient, &item_type, &0u32);
    assert_eq!(result, Err(Ok(Error::ZeroQuantity)));
}

#[test]
fn confirming_unknown_claim_fails() {
    let (_env, client, _vendor, recipient) = setup();

    let result = client.try_confirm_pickup(&999u64, &recipient);
    assert_eq!(result, Err(Ok(Error::ClaimNotFound)));
}
