require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { Connection } = require("@solana/web3.js");

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


if (!process.env.DATABASE_URL) {

  console.error(
    "DATABASE_URL is missing"
  );

  process.exit(1);

}


const pool = new Pool({

  connectionString:
    process.env.DATABASE_URL,

  ssl:{
    rejectUnauthorized:false
  }

});


async function initDatabase(){

  await pool.query(`

    CREATE TABLE IF NOT EXISTS payments (

      id SERIAL PRIMARY KEY,

      payment_id TEXT UNIQUE NOT NULL,

      amount NUMERIC(20,9) NOT NULL,

      currency TEXT NOT NULL DEFAULT 'SOL',

      description TEXT,

      merchant TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'Pending',

      signature TEXT UNIQUE,

      verified_amount NUMERIC(20,9),

      created_at TIMESTAMPTZ DEFAULT NOW(),

      verified_at TIMESTAMPTZ

    );

  `);

}


function formatPayment(row){

  return {

    paymentId:
      row.payment_id,

    amount:
      Number(row.amount),

    currency:
      row.currency,

    description:
      row.description,

    merchant:
      row.merchant,

    status:
      row.status,

    signature:
      row.signature,

    verifiedAmount:
      row.verified_amount !== null
      ? Number(row.verified_amount)
      : null,

    createdAt:
      row.created_at,

    verifiedAt:
      row.verified_at

  };

}


/*
==============================
HEALTH
==============================
*/

app.get("/",async(req,res)=>{

  try{

    await pool.query("SELECT 1");

    res.json({

      service:
        "SolPay Africa API",

      network:
        "Solana Devnet",

      status:
        "online",

      database:
        "connected",

      merchant:
        MERCHANT

    });

  }catch(error){

    res.status(500).json({

      service:
        "SolPay Africa API",

      network:
        "Solana Devnet",

      status:
        "online",

      database:
        "error"

    });

  }

});


/*
==============================
CREATE PAYMENT
==============================
*/

app.post(
"/api/payments",
async(req,res)=>{

  try{

    const {
      amount,
      description
    }=req.body;


    const numericAmount=
      Number(amount);


    if(
      !Number.isFinite(numericAmount) ||
      numericAmount<=0
    ){

      return res.status(400).json({
        error:"Invalid amount"
      });

    }


    const paymentId=
      "SP-"+
      Date.now()+
      "-"+
      Math.random()
      .toString(36)
      .substring(2,8)
      .toUpperCase();


    const result=
      await pool.query(

        `

        INSERT INTO payments
        (
          payment_id,
          amount,
          currency,
          description,
          merchant,
          status
        )

        VALUES
        ($1,$2,$3,$4,$5,$6)

        RETURNING *

        `,

        [
          paymentId,
          numericAmount,
          "SOL",
          description ||
          "SolPay Payment",
          MERCHANT,
          "Pending"
        ]

      );


    res.json(
      formatPayment(
        result.rows[0]
      )
    );


  }catch(error){

    console.error(error);

    res.status(500).json({

      error:
        "Unable to create payment"

    });

  }

});


/*
==============================
GET PAYMENT
==============================
*/

app.get(
"/api/payments/:paymentId",
async(req,res)=>{

  try{

    const result=
      await pool.query(

        `

        SELECT *
        FROM payments
        WHERE payment_id=$1

        `,

        [
          req.params.paymentId
        ]

      );


    if(
      result.rows.length===0
    ){

      return res.status(404).json({

        error:
          "Payment not found"

      });

    }


    res.json(
      formatPayment(
        result.rows[0]
      )
    );


  }catch(error){

    console.error(error);

    res.status(500).json({

      error:
        "Database error"

    });

  }

});


/*
==============================
LIST PAYMENTS
==============================
*/

app.get(
"/api/payments",
async(req,res)=>{

  try{

    const result=
      await pool.query(

        `

        SELECT *
        FROM payments

        ORDER BY created_at DESC

        LIMIT 100

        `

      );


    res.json(
      result.rows.map(
        formatPayment
      )
    );


  }catch(error){

    console.error(error);

    res.status(500).json({

      error:
        "Database error"

    });

  }

});


/*
==============================
VERIFY PAYMENT
==============================
*/

app.post(
"/api/payments/:paymentId/verify",
async(req,res)=>{

  try{

    const paymentResult=
      await pool.query(

        `

        SELECT *
        FROM payments
        WHERE payment_id=$1

        `,

        [
          req.params.paymentId
        ]

      );


    if(
      paymentResult.rows.length===0
    ){

      return res.status(404).json({

        paid:false,

        error:
          "Payment not found"

      });

    }


    const payment=
      paymentResult.rows[0];


    const {
      signature
    }=req.body;


    if(
      typeof signature!=="string" ||
      signature.length<80 ||
      signature.length>120
    ){

      return res.status(400).json({

        paid:false,

        error:
          "Invalid transaction signature"

      });

    }


    if(
      payment.status==="Paid"
    ){

      return res.json({

        paid:true,

        status:"Paid",

        paymentId:
          payment.payment_id,

        amount:
          Number(
            payment.verified_amount
          ),

        signature:
          payment.signature,

        merchant:
          payment.merchant

      });

    }


    const usedSignature=
      await pool.query(

        `

        SELECT payment_id
        FROM payments
        WHERE signature=$1

        `,

        [signature]

      );


    if(
      usedSignature.rows.length>0
    ){

      return res.json({

        paid:false,

        status:
          "SignatureAlreadyUsed",

        error:
          "Transaction already used"

      });

    }


    const transaction=
      await connection.getParsedTransaction(

        signature,

        {
          commitment:"confirmed",

          maxSupportedTransactionVersion:0
        }

      );


    if(!transaction){

      return res.status(404).json({

        paid:false,

        status:"NotFound",

        error:
          "Transaction not found on Solana Devnet"

      });

    }


    if(
      transaction.meta &&
      transaction.meta.err
    ){

      return res.json({

        paid:false,

        status:"Failed",

        error:
          "Transaction failed on Solana"

      });

    }


    let received=0;

    let merchantFound=false;


    for(
      const instruction
      of transaction
      .transaction
      .message
      .instructions
    ){

      if(
        instruction.parsed &&
        instruction.program==="system" &&
        instruction.parsed.type==="transfer"
      ){

        const info=
          instruction.parsed.info;


        if(
          info.destination===
          MERCHANT
        ){

          merchantFound=true;

          received=
            Number(
              info.lamports
            )/1000000000;

          break;

        }

      }

    }


    if(!merchantFound){

      return res.json({

        paid:false,

        status:
          "InvalidMerchant",

        error:
          "Payment was not sent to merchant wallet"

      });

    }


    const expected=
      Number(payment.amount);


    if(
      Math.abs(
        received-expected
      )>0.000000001
    ){

      return res.json({

        paid:false,

        status:
          "InvalidAmount",

        expected,

        received,

        error:
          "Payment amount does not match"

      });

    }


    const updated=
      await pool.query(

        `

        UPDATE payments

        SET

          status='Paid',

          signature=$1,

          verified_amount=$2,

          verified_at=NOW()

        WHERE payment_id=$3

        AND status='Pending'

        RETURNING *

        `,

        [
          signature,
          received,
          payment.payment_id
        ]

      );


    if(
      updated.rows.length===0
    ){

      return res.json({

        paid:false,

        status:
          "AlreadyProcessed"

      });

    }


    const paid=
      updated.rows[0];


    res.json({

      paid:true,

      status:"Paid",

      paymentId:
        paid.payment_id,

      amount:
        Number(
          paid.verified_amount
        ),

      signature:
        paid.signature,

      merchant:
        paid.merchant,

      network:
        "Solana Devnet"

    });


  }catch(error){

    console.error(
      "Verification error:",
      error
    );

    res.status(500).json({

      paid:false,

      error:
        "Verification failed"

    });

  }

});


/*
==============================
START
==============================
*/

initDatabase()

.then(()=>{

  app.listen(
    PORT,
    ()=>{

      console.log(
        `SolPay Africa API running on port ${PORT}`
      );

    }
  );

})

.catch(error=>{

  console.error(
    "Database initialization failed:",
    error
  );

  process.exit(1);

});
