#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String};

/// A pickup claim moves from `Pending` (vendor has claimed it) to `Finalized`
/// (recipient has independently confirmed it) and then never changes again.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimStatus {
    Pending,
    Finalized,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub vendor: Address,
    pub recipient: Address,
    pub item_type: String,
    pub quantity: u32,
    pub claimed_at: u64,
    pub confirmed_at: u64,
    pub status: ClaimStatus,
}

#[contracttype]
pub enum DataKey {
    // Keyed by the order's own id (a UUID string from Eatovr's existing
    // Order model), not an auto-incremented counter. This is the whole
    // point of this version: the order id exists at purchase time,
    // *before* either party claims or confirms anything, so the
    // recipient can sign a `confirm_pickup` authorization ahead of time
    // (at checkout) referencing an id that already exists — instead of
    // needing to wait for `claim_pickup` to mint a fresh claim id before
    // there's anything to sign. See
    // docs/PASSKEY_ATTESTATION_INTEGRATION_PLAN.md's deferred-confirm
    // section for the full flow this enables.
    Claim(String),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ClaimNotFound = 1,
    AlreadyFinalized = 2,
    RecipientMismatch = 3,
    VendorIsRecipient = 4,
    ZeroQuantity = 5,
    ClaimAlreadyExists = 6,
}

#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    /// Vendor claims a pickup happened: item type, quantity, and the
    /// recipient who is expected to confirm it. Only `vendor`'s own
    /// authorization can create a claim on their behalf.
    ///
    /// `order_id` is Eatovr's own order id, supplied by the caller
    /// (not minted here) — see `DataKey::Claim`'s doc comment for why.
    /// The claim stays `Pending` until the recipient independently
    /// confirms it with `confirm_pickup`.
    pub fn claim_pickup(
        env: Env,
        order_id: String,
        vendor: Address,
        recipient: Address,
        item_type: String,
        quantity: u32,
    ) -> Result<(), Error> {
        vendor.require_auth();

        if vendor == recipient {
            return Err(Error::VendorIsRecipient);
        }
        if quantity == 0 {
            return Err(Error::ZeroQuantity);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Claim(order_id.clone()))
        {
            return Err(Error::ClaimAlreadyExists);
        }

        let claim = Claim {
            vendor: vendor.clone(),
            recipient: recipient.clone(),
            item_type: item_type.clone(),
            quantity,
            claimed_at: env.ledger().timestamp(),
            confirmed_at: 0,
            status: ClaimStatus::Pending,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Claim(order_id.clone()), &claim);

        env.events().publish(
            (symbol_short!("claimed"), order_id),
            (vendor, recipient, item_type, quantity),
        );

        Ok(())
    }

    /// Recipient independently confirms a specific claim, by the same
    /// `order_id` `claim_pickup` used. Only the recipient named on the
    /// claim can confirm it, and only their own authorization can do
    /// so — the vendor cannot confirm on their behalf. Finalizing
    /// requires both this call and the earlier `claim_pickup` auth
    /// check to have passed; there is no path that finalizes a record
    /// from a single party.
    ///
    /// This call's authorization entry can be produced and signed by
    /// the recipient *before* `claim_pickup` ever runs (e.g. at
    /// checkout, since `order_id` already exists then) and submitted
    /// later by anyone holding that signed entry — `require_auth()`
    /// only checks that the recipient signed this exact call, not when
    /// the signature was produced or who relayed it on-chain.
    pub fn confirm_pickup(env: Env, order_id: String, recipient: Address) -> Result<(), Error> {
        recipient.require_auth();

        let mut claim: Claim = env
            .storage()
            .persistent()
            .get(&DataKey::Claim(order_id.clone()))
            .ok_or(Error::ClaimNotFound)?;

        if claim.recipient != recipient {
            return Err(Error::RecipientMismatch);
        }
        if claim.status != ClaimStatus::Pending {
            return Err(Error::AlreadyFinalized);
        }

        claim.confirmed_at = env.ledger().timestamp();
        claim.status = ClaimStatus::Finalized;
        env.storage()
            .persistent()
            .set(&DataKey::Claim(order_id.clone()), &claim);

        env.events().publish(
            (symbol_short!("finalized"), order_id),
            (
                claim.vendor,
                claim.recipient,
                claim.item_type,
                claim.quantity,
                claim.claimed_at,
                claim.confirmed_at,
            ),
        );

        Ok(())
    }

    pub fn get_claim(env: Env, order_id: String) -> Result<Claim, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(order_id))
            .ok_or(Error::ClaimNotFound)
    }
}

#[cfg(test)]
mod test;
