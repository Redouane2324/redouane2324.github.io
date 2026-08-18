require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
  Connection,
  PublicKey
} = require("@solana/web3.js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const RPC_URL =
  process.env.RPC_URL ||
  "https://api.devnet.solana.com";

const MERCHANT =
  "DusJY2A9f3vM9APtPG7EwRZo1emoSNNKrimSF7JU1pwW";

const connection =
  new Connection(RPC_URL, "confirmed");

const payments = new Map();

/*
========================================
HEALTH CHECK
========================================
*/

app.get("/", (req, res) => {
  res.json({
    service: "SolPay Africa API",
    network: "Solana Devnet",
    status: "online"
  });
});


/*
========================================
CREATE PAYMENT
========================================
*/

app.post("/api/payments", (req, res) => {

  try {

    const {
      amount,
      description
    } = req.body;

    const numericAmount =
      Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return res.status(400).json({
        error: "Invalid amount"
      });
    }

    const paymentId =
      "SP-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    const payment = {

      paymentId,

      amount: numericAmount,

      currency: "SOL",

      merchant: MERCHANT,

      description:
        description ||
        "SolPay Payment",

      status: "Pending",

      signature: null,

      createdAt:
        new Date().toISOString()

    };

    payments.set(
      paymentId,
      payment
    );

    res.json(payment);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Unable to create payment"
    });

  }

});


/*
========================================
GET PAYMENT
========================================
*/

app.get(
  "/api/payments/:paymentId",
  (req, res) => {

    const payment =
      payments.get(
        req.params.paymentId
      );

    if (!payment) {

      return res.status(404).json({
        error: "Payment not found"
      });

    }

    res.json(payment);

  }
);


/*
========================================
VERIFY PAYMENT
========================================
*/

app.post(
  "/api/payments/:paymentId/verify",
  async (req, res) => {

    try {

      const payment =
        payments.get(
          req.params.paymentId
        );

      if (!payment) {

        return res.status(404).json({
          error: "Payment not found"
        });

      }

      const {
        signature
      } = req.body;

      if (!signature) {

        return res.status(400).json({
          error:
            "Transaction signature is required"
        });

      }

      /*
      Validate signature format
      */

      if (
        typeof signature !== "string" ||
        signature.length < 80 ||
        signature.length > 100
      ) {

        return res.status(400).json({
          error:
            "Invalid transaction signature"
        });

      }

      /*
      Get transaction from Solana
      */

      const transaction =
        await connection.getParsedTransaction(
          signature,
          {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0
          }
        );

      if (!transaction) {

        return res.status(404).json({

          paid: false,

          status: "NotFound",

          error:
            "Transaction not found on Solana Devnet"

        });

      }

      /*
      Check transaction error
      */

      if (
        transaction.meta &&
        transaction.meta.err
      ) {

        return res.json({

          paid: false,

          status: "Failed",

          error:
            "Transaction failed on Solana"

        });

      }

      /*
      Search for SOL transfer
      */

      let verifiedAmount = 0;

      let verifiedMerchant = false;

      let foundTransfer = false;


      const instructions =
        transaction.transaction
          .message
          .instructions;


      for (
        const instruction
        of instructions
      ) {

        if (
          instruction.parsed &&
          instruction.program === "system" &&
          instruction.parsed.type === "transfer"
        ) {

          const info =
            instruction.parsed.info;

          const destination =
            info.destination;

          const lamports =
            Number(info.lamports);

          if (
            destination === MERCHANT
          ) {

            verifiedMerchant = true;

            verifiedAmount =
              lamports / 1000000000;

            foundTransfer = true;

            break;

          }

        }

      }


      /*
      Check merchant
      */

      if (!verifiedMerchant) {

        return res.json({

          paid: false,

          status: "InvalidMerchant",

          error:
            "Payment was not sent to the SolPay merchant wallet"

        });

      }


      /*
      Check amount
      */

      const expected =
        Number(payment.amount);

      const tolerance =
        0.000000001;

      if (
        Math.abs(
          verifiedAmount - expected
        ) > tolerance
      ) {

        return res.json({

          paid: false,

          status: "InvalidAmount",

          expected,

          received:
            verifiedAmount,

          error:
            "Transaction amount does not match Payment ID"

        });

      }


      /*
      Payment ID verification
      */

      /*
      The Payment ID is encoded in the
      transaction memo in the production
      version.

      For the current Devnet MVP we require
      the signature to be submitted against
      the specific Payment ID and verify
      amount + merchant + transaction.

      We will add an on-chain Memo instruction
      next so Payment ID is cryptographically
      attached to the transaction.
      */


      payment.signature =
        signature;

      payment.status =
        "Paid";

      payment.verifiedAmount =
        verifiedAmount;

      payment.verifiedAt =
        new Date().toISOString();


      payments.set(
        payment.paymentId,
        payment
      );


      return res.json({

        paid: true,

        status: "Paid",

        paymentId:
          payment.paymentId,

        signature,

        amount:
          verifiedAmount,

        merchant:
          MERCHANT

      });

    } catch (error) {

      console.error(
        "Verification error:",
        error
      );

      return res.status(500).json({

        paid: false,

        error:
          "Verification failed"

      });

    }

  }
);


/*
========================================
START SERVER
========================================
*/

app.listen(
  PORT,
  () => {

    console.log(
      `SolPay Africa API running on port ${PORT}`
    );

  }
);
