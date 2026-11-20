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
    NextId,
    Claim(u64),
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
}

#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    /// Vendor claims a pickup happened: item type, quantity, and the
    /// recipient who is expected to confirm it. Only `vendor`'s own
    /// authorization can create a claim on their behalf.
    ///
    /// Returns the new claim's id. The claim stays `Pending` until the
    /// recipient independently confirms it with `confirm_pickup`.
    pub fn claim_pickup(
        env: Env,
        vendor: Address,
        recipient: Address,
        item_type: String,
        quantity: u32,
    ) -> Result<u64, Error> {
        vendor.require_auth();

        if vendor == recipient {
            return Err(Error::VendorIsRecipient);
        }
        if quantity == 0 {
            return Err(Error::ZeroQuantity);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0);

        let claim = Claim {
            vendor: vendor.clone(),
            recipient: recipient.clone(),
            item_type: item_type.clone(),
            quantity,
            claimed_at: env.ledger().timestamp(),
            confirmed_at: 0,
            status: ClaimStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::Claim(id), &claim);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (symbol_short!("claimed"), id),
            (vendor, recipient, item_type, quantity),
        );

        Ok(id)
    }

    /// Recipient independently confirms a specific claim. Only the
    /// recipient named on the claim can confirm it, and only their own
    /// authorization can do so — the vendor cannot confirm on their
    /// behalf. Finalizing requires both this call and the earlier
    /// `claim_pickup` auth check to have passed; there is no path that
    /// finalizes a record from a single party.
    pub fn confirm_pickup(env: Env, claim_id: u64, recipient: Address) -> Result<(), Error> {
        recipient.require_auth();

        let mut claim: Claim = env
            .storage()
            .persistent()
            .get(&DataKey::Claim(claim_id))
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
            .set(&DataKey::Claim(claim_id), &claim);

        env.events().publish(
            (symbol_short!("finalized"), claim_id),
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

    pub fn get_claim(env: Env, claim_id: u64) -> Result<Claim, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(claim_id))
            .ok_or(Error::ClaimNotFound)
    }
}

#[cfg(test)]
mod test;
