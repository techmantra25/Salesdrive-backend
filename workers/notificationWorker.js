// room: "role:admin"
// const { Worker } = require("bullmq");
// const connection = require("../redisConnection");
// const Notification = require("../models/notification.model");
// const { getIO } = require("../socket");

// const BATCH_SIZE = 200;

// const worker = new Worker(
//   "notifications",
//   async (job) => {
//     try {
//       const { type, userId, userType, data, room } = job.data;

//       if (!type || !data?.message) {
//         throw new Error("Invalid notification payload");
//       }

//       const io = getIO();
//       const now = new Date();

//       // ====================================================
//       // ✅ 1️⃣ ROLE-BASED NOTIFICATION (ADMIN etc.)
//       // ====================================================
//       if (room && room.startsWith("role:")) {
//         const role = room.replace("role:", "");

//         // ✅ Save in DB
//         const savedNotification = await Notification.create({
//           role,
//           type,
//           title: data.title || null,
//           message: data.message,
//           read: false,
//           createdAt: now,
//           updatedAt: now,
//         });

//         // ✅ Emit to role room
//         io.to(room).emit("notification", {
//           _id: savedNotification._id,
//           type: savedNotification.type,
//           title: savedNotification.title,
//           message: savedNotification.message,
//           createdAt: savedNotification.createdAt,
//         });

//         console.log(`✅ Role notification saved & sent to ${room}`);

//         return { success: true };
//       }

//       // ====================================================
//       // ✅ 2️⃣ USER-BASED NOTIFICATION (Bulk Supported)
//       // ====================================================
//       const recipientIds = Array.isArray(userId)
//         ? userId
//         : userId
//         ? [userId]
//         : [];

//       if (!recipientIds.length) {
//         console.log("⚠️ No recipients found");
//         return { success: false };
//       }

//       // ✅ Prepare bulk insert data
//       const notificationsToInsert = recipientIds.map((uid) => ({
//         userId: uid,
//         userType: userType || null,
//         type,
//         title: data.title || null,
//         message: data.message,
//         read: false,
//         createdAt: now,
//         updatedAt: now,
//       }));

//       // ✅ Bulk insert (fast & memory efficient)
//       const insertedNotifications = await Notification.insertMany(
//         notificationsToInsert,
//         { ordered: false }
//       );

//       // ====================================================
//       // ✅ 3️⃣ Emit via Socket (Batched)
//       // ====================================================
//       for (let i = 0; i < insertedNotifications.length; i += BATCH_SIZE) {
//         const batch = insertedNotifications.slice(i, i + BATCH_SIZE);

//         batch.forEach((n) => {
//           const roomPrefix = {
//             User: "user",
//             OutletApproved: "user",
//             Distributor: "user",
//           }[n.userType] || "user";

//           io.to(`${roomPrefix}:${n.userId}`).emit("notification", {
//             _id: n._id,
//             type: n.type,
//             title: n.title,
//             message: n.message,
//             createdAt: n.createdAt,
//           });
//         });
//       }

//       console.log(
//         `✅ User notifications processed: ${insertedNotifications.length}`
//       );

//       return { success: true, count: insertedNotifications.length };
//     } catch (error) {
//       console.error("❌ Notification worker error:", error.message);
//       throw error;
//     }
//   },
//   {
//     connection,
//     concurrency: 50, // 🚀 Handles 10k+ bulk safely
//     removeOnComplete: {
//       age: 60 * 60, // keep for 1 hour
//       count: 5000,
//     },
//     removeOnFail: {
//       age: 24 * 60 * 60,
//     },
//   }
// );

// // ====================================================
// // Worker Events
// // ====================================================
// worker.on("completed", (job) =>
//   console.log(`✅ Job ${job.id} completed`)
// );

// worker.on("failed", (job, err) =>
//   console.error(`❌ Job ${job?.id} failed:`, err.message)
// );

// worker.on("error", (err) =>
//   console.error("🚨 Worker crashed:", err)
// );

// // ====================================================
// // Graceful Shutdown
// // ====================================================
// const shutdown = async () => {
//   console.log("🛑 Closing notification worker...");
//   await worker.close();
//   process.exit(0);
// };

// process.on("SIGTERM", shutdown);
// process.on("SIGINT", shutdown);

// module.exports = worker;


const { Worker } = require("bullmq");
const connection = require("../redisConnection");
const Notification = require("../models/notification.model");
const { getIO } = require("../socket");

const BATCH_SIZE = 200;

const worker = new Worker(
  "notifications",
  async (job) => {
    const { type, userId, userType, data, room } = job.data;

    if (!type || !data?.message) {
      console.error("❌ Invalid notification payload");
      return { success: false };
    }

    const io = getIO();
    const now = new Date();

    try {
      // ====================================================
      // ✅ 1️⃣ ROLE-BASED NOTIFICATION
      // ====================================================
      if (room && room.startsWith("role:")) {
        const role = room.replace("role:", "");

        // Save once only
        const savedNotification = await Notification.create({
          role,
          type,
          title: data.title || null,
          message: data.message,
          read: false,
          createdAt: now,
          updatedAt: now,
        });

        // Emit safely (DO NOT FAIL JOB)
        try {
          io.to(room).emit("notification", {
            _id: savedNotification._id,
            type: savedNotification.type,
            title: savedNotification.title,
            message: savedNotification.message,
            createdAt: savedNotification.createdAt,
          });
        } catch (socketError) {
          console.error("⚠️ Socket emit failed:", socketError.message);
        }

        console.log(`✅ Role notification processed for ${room}`);
        return { success: true };
      }

      // ====================================================
      // ✅ 2️⃣ USER-BASED NOTIFICATION
      // ====================================================
      const recipientIds = Array.isArray(userId)
        ? userId
        : userId
        ? [userId]
        : [];

      if (!recipientIds.length) {
        console.log("⚠️ No recipients found");
        return { success: false };
      }

      // Prepare bulk data
      const notificationsToInsert = recipientIds.map((uid) => ({
        userId: uid,
        userType: userType || null,
        type,
        title: data.title || null,
        message: data.message,
        read: false,
        createdAt: now,
        updatedAt: now,
      }));

      // Bulk insert
      const insertedNotifications = await Notification.insertMany(
        notificationsToInsert,
        { ordered: false }
      );

      // Emit in batches (safe emit)
      for (let i = 0; i < insertedNotifications.length; i += BATCH_SIZE) {
        const batch = insertedNotifications.slice(i, i + BATCH_SIZE);

        batch.forEach((n) => {
          const roomPrefix =
            {
              User: "user",
              OutletApproved: "user",
              Distributor: "user",
              Employee: "employee",
            }[n.userType] || "user";

          try {
            io.to(`${roomPrefix}:${n.userId}`).emit("notification", {
              _id: n._id,
              type: n.type,
              title: n.title,
              message: n.message,
              createdAt: n.createdAt,
            });
          } catch (socketError) {
            console.error(
              `⚠️ Socket emit failed for user ${n.userId}:`,
              socketError.message
            );
          }
        });
      }

      console.log(
        `✅ User notifications processed: ${insertedNotifications.length}`
      );

      return { success: true, count: insertedNotifications.length };
    } catch (error) {
      // Only DB errors should fail job
      console.error("❌ Notification worker DB error:", error.message);
      throw error;
    }
  },
  {
    connection,

    // 🔥 Reduced for 30MB Redis
    concurrency: 15,

    // 🔥 Instant cleanup (low memory)
    removeOnComplete: true,

    // 🔥 Remove failed quickly to save memory
    removeOnFail: {
      age: 3600, // keep failed jobs for 1 hour only
      count: 200,
    },
  }
);

// ====================================================
// Worker Events
// ====================================================

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("🚨 Worker crashed:", err);
});

// ====================================================
// Graceful Shutdown
// ====================================================

const shutdown = async () => {
  console.log("🛑 Closing notification worker...");
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = worker;