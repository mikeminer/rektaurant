import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const CONTRACT_NAME = "rektaurant-vault";

describe("rektaurant-vault", () => {
  it("starts with no deposits", () => {
    const result = simnet.callReadOnlyFn(
      CONTRACT_NAME,
      "get-next-deposit-id",
      [],
      simnet.deployer
    );

    expect(result.result).toBeUint(0);
  });

  it("records an STX deposit", () => {
    const accounts = simnet.getAccounts();
    const wallet = accounts.get("wallet_1")!;

    const deposit = simnet.callPublicFn(
      CONTRACT_NAME,
      "deposit",
      [Cl.uint(1_000_000), Cl.stringAscii("Rektaurant vault plate")],
      wallet
    );

    expect(deposit.result).toBeOk(Cl.uint(0));

    const nextId = simnet.callReadOnlyFn(
      CONTRACT_NAME,
      "get-next-deposit-id",
      [],
      simnet.deployer
    );

    expect(nextId.result).toBeUint(1);
  });
});
