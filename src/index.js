import mongoose from "mongoose";
import {DB_NAME} from "./constants.js";
import dotenv from "dotenv";
import express from "express";
import connectDB from "./db/index.db.js";


// better & professional approach
dotenv.config({
  path: "../.env"
});

await connectDB();











/*
// first approach
const app = express();

(async ()=> {
    try {
      await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
      app.on("error", (error) => {
        console.error("Error: ", error);
        throw error;
      });

      app.listen(process.env.PORT, () => {
        console.log(`App is listening on port http://localhost:${process.env.PORT}`);
      });
    } catch (error) {
      console.error("Error: ", error);
      throw error;
    }
})();
*/