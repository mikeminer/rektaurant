;; Rektaurant Vault
;; A simple STX piggy-bank contract for the Rektaurant project.

(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u401))
(define-constant err-invalid-amount (err u400))

(define-data-var next-deposit-id uint u0)

(define-map deposits
  uint
  {
    sender: principal,
    amount: uint,
    memo: (string-ascii 80),
    at: uint
  }
)

(define-public (deposit (amount uint) (memo (string-ascii 80)))
  (let
    (
      (deposit-id (var-get next-deposit-id))
    )
    (asserts! (> amount u0) err-invalid-amount)
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set deposits deposit-id
      {
        sender: tx-sender,
        amount: amount,
        memo: memo,
        at: block-height
      }
    )
    (var-set next-deposit-id (+ deposit-id u1))
    (print
      {
        event: "rektaurant-deposit",
        id: deposit-id,
        sender: tx-sender,
        amount: amount,
        memo: memo
      }
    )
    (ok deposit-id)
  )
)

(define-public (withdraw (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (> amount u0) err-invalid-amount)
    (as-contract (stx-transfer? amount tx-sender recipient))
  )
)

(define-read-only (get-deposit (deposit-id uint))
  (map-get? deposits deposit-id)
)

(define-read-only (get-next-deposit-id)
  (var-get next-deposit-id)
)

(define-read-only (get-owner)
  contract-owner
)

(define-read-only (get-vault-balance)
  (stx-get-balance (as-contract tx-sender))
)
