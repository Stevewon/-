-- Migration 0035: Quantarium chain metadata correction + exchange hot wallet
--
-- WHY: Migration 0015 seeded qta_chain_state with signature_scheme =
-- 'CRYSTALS-Dilithium3', matching an old assumption that QTA was a bespoke
-- PQ mainnet. On-chain verification against https://scan.quantarium.io and
-- https://rpc.quantarium.io (2026-08-10) confirmed the real design:
--
--   - chain_id: 60000
--   - Consensus: EVM-compatible Geth fork
--   - Block signatures: SPHINCS+-SHA2-128s (NIST PQC, hash-based)
--   - Transaction signatures: standard ECDSA (EIP-1559)
--   - Addresses: standard 20-byte EVM (0x...)
--   - Native coin: QTA (18 decimals)
--   - Reference tokens: QX (0xad447d42...), QKEY (0x216621D3...)
--
-- WHAT: (1) fix the signature_scheme label in qta_chain_state so admin UI
-- and status endpoints report the truth, and (2) record the dedicated
-- exchange hot wallet address so future adapters have a single source of
-- truth to reconcile against.
--
-- Exchange hot wallet: 0x496EEaCE6Cf759C95e9eFea5d4C16A35D0524E97
--   - EOA (not contract), issued 2026-08-10 by QuantaEX Holdings Ltd.
--   - Verified: eth_getCode = 0x, nonce = 0, balance = 0 at issuance.
--   - Separate from the Master/Treasury wallet 0xE0c166...4f0e.
--
-- Marker key: qta_chain_correction_2026_08_10 = migrated_v1

-- 1) Correct the signature scheme label wherever qta_chain_state has been seeded.
UPDATE qta_chain_state
   SET signature_scheme = 'SPHINCS+-SHA2-128s (blocks) / ECDSA (tx)'
 WHERE signature_scheme = 'CRYSTALS-Dilithium3'
    OR signature_scheme IS NULL;

-- 2) Record the exchange hot wallet address into qta_chain_state so ticker /
--    admin UI can display it and reconciliation queries have a canonical
--    reference. hot_wallet_addr already exists in the 0015 schema.
UPDATE qta_chain_state
   SET hot_wallet_addr = '0x496EEaCE6Cf759C95e9eFea5d4C16A35D0524E97'
 WHERE hot_wallet_addr IS NULL
    OR hot_wallet_addr = ''
    OR hot_wallet_addr LIKE 'qta1%';

-- 3) Long-lived audit record: keep the wallet issuance event in system_state
--    so operators can trace when the address was adopted, independent of
--    later qta_chain_state overwrites by the cron ticker.
INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES (
  'qta_exchange_hot_wallet',
  '{"address":"0x496EEaCE6Cf759C95e9eFea5d4C16A35D0524E97",'
    || '"chain_id":60000,'
    || '"chain_name":"Quantarium",'
    || '"kind":"EOA",'
    || '"role":"exchange_hot_wallet",'
    || '"issued_at":"2026-08-10",'
    || '"verified":{"nonce":0,"balance_qta":"0","is_contract":false},'
    || '"custody_model":"scenario_c_hybrid",'
    || '"bot_wallet":"@quantarium_bot"}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

-- 4) Migration marker.
INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES (
  'qta_chain_correction_2026_08_10',
  'migrated_v1',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
