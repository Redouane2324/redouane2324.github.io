require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bs58 = require("bs58");

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

const MEMO_PROGRAM =
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const connection =
  new Connection(
    RPC_URL,
    "confirmed"
  );

const payments = new Map();

/*
========================================
HEALTH
========================================
*/

app.get("/", (req, res) => {

  res.json({
    service: "SolPay Africa API",
    network: "Solana Devnet",
    status: "online",
    merchant: MERCHANT
  });

});


/*
========================================
CREATE PAYMENT
========================================
*/

app.post(
  "/api/payments",
  (req, res) => {

    try {

      const {
        amount,
        description
      } = req.body;

      const numericAmount =
        Number(amount);

      if (
        !Number.isFinite(
          numericAmount
        ) ||
        numericAmount <= 0
      ) {

        return res.status(400).json({
          error:
            "Invalid amount"
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

        amount:
          numericAmount,

        currency:
          "SOL",

        merchant:
          MERCHANT,

        description:
          description ||
          "SolPay Payment",

        status:
          "Pending",

        signature:
          null,

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
        error:
          "Unable to create payment"
      });

    }

  }
);


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
        error:
          "Payment not found"
      });

    }

    res.json(payment);

  }
);


/*
========================================
LIST PAYMENTS
========================================
*/

app.get(
  "/api/payments",
  (req, res) => {

    const list =
      Array.from(
        payments.values()
      ).reverse();

    res.json(list);

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
          paid: false,
          error:
            "Payment not found"
        });

      }

      const {
        signature
      } = req.body;

      if (!signature) {

        return res.status(400).json({
          paid: false,
          error:
            "Transaction signature is required"
        });

      }

      if (
        payment.status === "Paid"
      ) {

        return res.json({

          paid:
            true,

          status:
            "Paid",

          paymentId:
            payment.paymentId,

          signature:
            payment.signature,

          amount:
            payment.verifiedAmount,

          merchant:
            MERCHANT

        });

      }

      /*
      ==================================
      GET TRANSACTION
      ==================================
      */

      const transaction =
        await connection.getParsedTransaction(
          signature,
          {
            commitment:
              "confirmed",

            maxSupportedTransactionVersion:
              0
          }
        );

      if (!transaction) {

        return res.status(404).json({

          paid:
            false,

          status:
            "NotFound",

          error:
            "Transaction not found on Solana Devnet"

        });

      }


      /*
      ==================================
      TRANSACTION ERROR
      ==================================
      */

      if (
        transaction.meta &&
        transaction.meta.err
      ) {

        return res.json({

          paid:
            false,

          status:
            "Failed",

          error:
            "Transaction failed"

        });

      }


      /*
      ==================================
      FIND TRANSFER
      ==================================
      */

      let verifiedAmount =
        0;

      let verifiedMerchant =
        false;

      let verifiedMemo =
        false;

      const instructions =
        transaction.transaction
          .message
          .instructions;


      for (
        const instruction
        of instructions
      ) {

        /*
        SOL TRANSFER
        */

        if (
          instruction.parsed &&
          instruction.program ===
            "system" &&
          instruction.parsed.type ===
            "transfer"
        ) {

          const info =
            instruction.parsed.info;

          if (
            info.destination ===
            MERCHANT
          ) {

            verifiedMerchant =
              true;

            verifiedAmount =
              Number(
                info.lamports
              ) / 1000000000;

          }

        }


        /*
        MEMO
        */

        if (
          instruction.programId &&
          instruction.programId.toString() ===
            MEMO_PROGRAM
        ) {

          try {

            const decoded =
              bs58.decode(
                instruction.data
              );

            const memo =
              Buffer
                .from(decoded)
                .toString("utf8");

            if (
              memo ===
              payment.paymentId
            ) {

              verifiedMemo =
                true;

            }

          } catch (memoError) {

            console.log(
              "Memo decode error",
              memoError
            );

          }

        }

      }


      /*
      ==================================
      MERCHANT
      ==================================
      */

      if (!verifiedMerchant) {

        return res.json({

          paid:
            false,

          status:
            "InvalidMerchant",

          error:
            "Funds were not sent to the SolPay merchant wallet"

        });

      }


      /*
      ==================================
      AMOUNT
      ==================================
      */

      const expected =
        Number(
          payment.amount
        );

      const tolerance =
        0.000000001;


      if (
        Math.abs(
          verifiedAmount -
          expected
        ) > tolerance
      ) {

        return res.json({

          paid:
            false,

          status:
            "InvalidAmount",

          expected,

          received:
            verifiedAmount,

          error:
            "Payment amount does not match"

        });

      }


      /*
      ==================================
      MEMO / PAYMENT ID
      ==================================
      */

      if (!verifiedMemo) {

        return res.json({

          paid:
            false,

          status:
            "InvalidPaymentId",

          error:
            "Payment ID memo not found in transaction"

        });

      }


      /*
      ==================================
      SUCCESS
      ==================================
      */

      payment.status =
        "Paid";

      payment.signature =
        signature;

      payment.verifiedAmount =
        verifiedAmount;

      payment.verifiedAt =
        new Date().toISOString();

      payments.set(
        payment.paymentId,
        payment
      );


      res.json({

        paid:
          true,

        status:
          "Paid",

        paymentId:
          payment.paymentId,

        amount:
          verifiedAmount,

        merchant:
          MERCHANT,

        signature,

        network:
          "Solana Devnet"

      });

    } catch (error) {

      console.error(
        "Verification error:",
        error
      );

      res.status(500).json({

        paid:
          false,

        error:
          "Verification failed"

      });

    }

  }
);


/*
========================================
START
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
