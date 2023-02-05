const express = require('express');
const app = express();
const cors = require("cors");
const nodemailer = require("nodemailer");
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const { json } = require('express');
const stripe = require("stripe")(process.env.STRIPE_TEST_SECRET_KEY)
// Middle Ware
app.use(cors());
app.use(express.json());
// Sendgrid
const sgMail = require("sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const port = process.env.PORT || 5000;
app.listen(port, () => {
	console.log("Doctor Portal Server is Running >" + "port", port)
})
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster01.zifoud3.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
	try {
		const AppoinmentOptionsCollections = client.db("DoctorPortals").collection("AppointmentOptions");
		const BookingSCollections = client.db("DoctorPortals").collection("Booking");
		const AllUserCollections = client.db("DoctorPortals").collection("AllUser");
		const AddDoctorCollections = client.db("DoctorPortals").collection("Doctors");
		const PaymentInfoCollections = client.db("DoctorPortals").collection("PaymentInfo");
		// Create JSON JWT Token from Login/SignUp
		app.post('/jwt', async (req, res) => {
			const user = req.body;
			const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "10h" })
			res.send({ accessToken: token });
		});
		// JWT Verifying Middleware/Function
		function VerifyJWT(req, res, next) {
			const AuthHeader = req?.headers?.authorization;
			console.log(AuthHeader, "AuthHeader")
			if (!AuthHeader) {
				return res.status(401).send({ message: "Authheader Access error" })
			}
			const token = AuthHeader.split(' ')[1];
			jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
				if (err) {
					return res.status(403).send({ message: "Forbidded Accesss error" })
				}
				req.decoded = decoded;
				next()
			})
		};
		// Send Mail to Customer after Cinfirm Booking
		const SendBookingEmail = (booking) => {
			const { email, treatmentName, slot, name, date } = booking;
			sgMail.sendMail({
				from: "tanzimulislamsabbir@outlook.com", // verified sender email
				to: email, // recipient email
				subject: `Your Appointment for ${treatmentName} is Confirmed`, // Subject line
				text: "", // plain text body
				html: `
                <div>
                <p>Hi, ${name},</p><br /><br /><br />
                <h4>Your Appointment for Treatment: ${treatmentName}</h4>
                <p>Please, visit us on ${date} at ${slot}</p>
                <p>Thanks for your Booking</p>
                <br /><br />
                <p>Happy to See you!</p>
                </div>
                `, // html body
			}, function (error, info) {
				if (error) {
					console.log(error);
				} else {
					console.log('Email sent: ' + info.response);
				}
			});

		}

		// Stripe Payment Method
		// This is a public sample test API key.
		// Don’t submit any personally identifiable information in requests made with this key.
		// Sign in to see your own test API key embedded in code samples.
		app.post("/create-payment-intent", async (req, res) => {
			const items = req.body;
			const amount = items.price * 100;
			console.log(amount, 'amount')

			// Create a PaymentIntent with the order amount and currency
			const paymentIntent = await stripe.paymentIntents.create({
				amount: amount,
				currency: "usd",
				'payment_method_types': [
					'card'
				]
			})
			res.send({
				clientSecret: paymentIntent.client_secret,
			});
		});

		//    Update price field on Appointment Options
		// app.get('/updateprice', async (req, res) => {
		//     const filter = {};
		//     const options = { upsert: true };
		//     const updatePrice = { $set: { price: 99 } };
		//     const result = await AppoinmentOptionsCollections.updateMany(filter, updatePrice, options);
		//     res.status(201).send(result);
		// })

		// Get Appointment Options Data from Database (Public)
		app.get('/appointmentOptions', async (req, res) => {
			const bookingDate = req.query.date;
			const bookingUser = req.query.email;
			const query = {};
			const options = await AppoinmentOptionsCollections.find(query).toArray();
			const AlreadyBooked = await BookingSCollections.find({ date: bookingDate }).toArray();
			const bookedSlots = options.map(option => {
				const bookedOptions = AlreadyBooked.filter(book => book.treatmentName === option.treatmentName);
				const bookedSlot = bookedOptions.map((book => book.slot));
				const remainginSlots = option.slots.filter(slot => !bookedSlot.includes(slot))
				option.slots = remainginSlots;
			})
			res.send(options);
		});
		// Add Payment to Database from dashboard/payment:id
		app.get('/dashboard/payment/:id', VerifyJWT, async (req, res) => {
			console.log(req.params, 'from dashboard payment')
			const UserId = req.params.id;
			const result = await BookingSCollections.findOne({ _id: ObjectId(UserId) });
			if (result._id) {
				return res.send(result);
			}
			return res.send({ message: `Data didn't get` });
		})

		// Adding Payment_Sucessed _Info_Data to 'PaymentInfo' and Updating/Adding 'paid' option on 'BookingData'
		app.post('/paymentInfo', async (req, res) => {
			const paymentData = req.body;
			const result = await PaymentInfoCollections.insertOne(paymentData);
			const bookingId = req.body.bookingId;
			const filterId = { _id: ObjectId(bookingId) };
			const transactionId = req.body.transactionId;
			const updateDoc = { $set: { paid: true, transactionId: transactionId } };
			const updatedBookingDoc = await BookingSCollections.updateOne(filterId, updateDoc);
			console.log(updatedBookingDoc, 'updatedBookingDoc');
			res.send(result);
		})

		// Add Data to Database from Dashboard/Add Doctor (Admin)
		app.post('/dashboard/adddoctor', VerifyJWT, async (req, res) => {
			const Doctors = req.body;
			const userEmail = req.query.email;
			const decodedEmail = req.decoded.email;
			const isUser = await AllUserCollections.find({ email: userEmail }).toArray();
			if (isUser.length) {
				const isAdmin = isUser.find(user => user.userType === "Admin");
				if (!isAdmin) {
					return res.status(401).send({ message: 'Unauthorized Access' })
				}
				console.log(isAdmin.email, "Yes, it's Admin")
				if (isAdmin.email !== decodedEmail) {
					return res.status(401).send({ message: 'Unauthorized Access' })
				}
				const query = {
					email: Doctors.email
				};
				const alreadyAdded = await AddDoctorCollections.find(query).toArray();
				if (alreadyAdded.length) {
					return res.status(409).send({ message: 'Doctor already Added' })
				}
				const result = await AddDoctorCollections.insertOne(Doctors);
				res.status(201).send({ result, message: 'Data added successfully' })
			}
			res.status(401).send({ message: 'Hey, who are you?' })
		})
		// Get Doctors Data from Dashboard/Add Doctor (Admin)
		app.get('/dashboard/adddoctor', async (req, res) => {
			const userEmail = req.query.email;
			const isUser = await AllUserCollections.find({ email: userEmail }).toArray();
			if (isUser.length) {
				const isAdmin = isUser.find(user => user.userType === "Admin");
				if (!isAdmin) {
					return res.status(401).send({ message: 'Unauthorized Access' })
				}
				const query = {};
				const result = await AddDoctorCollections.find(query).toArray();
				res.send(result);
			}
		})

		// Get data for Dashboard/Add_Doctor/specialty_selction_option
		app.get('/dashboard/specialty', async (req, res) => {
			const query = {};
			const result = await AppoinmentOptionsCollections.find(query).project({ treatmentName: 1 }).toArray();
			res.status(200).send(result);
		})

		//Adding Booking Data from Appointment/Appointment_Modal (Public)
		app.post('/booking', async (req, res) => {
			const BookingData = req.body;
			const userEmail = req.query.email;
			const query = {
				date: BookingData.date,
				email: BookingData.email,
				treatmentName: BookingData.treatmentName
			};
			if (!BookingData.email) {
				return res.send({ message: 'Hey, you should login!' })
			}
			const AlreadyBooked = await BookingSCollections.find(query).toArray();
			if (AlreadyBooked.length) {
				const message = `you already have a booking on ${BookingData.date}`
				return res.send({ acknowledged: false, message })
			}
			SendBookingEmail(BookingData)
			const result = await BookingSCollections.insertOne(BookingData);
			res.send(result);
		});

		// Get Booking Data for Appointment (Public)
		app.get('/booking', async (req, res) => {
			const options = await BookingSCollections.find().toArray();
			res.send(options);
		});
		// Get Booking Data for Dashboard/MyAppointment (Login User Email Based)
		app.get('/dashboard/booking', VerifyJWT, async (req, res) => {
			const decodedData = req.decoded;
			const queryEmail = req.query.email;
			if (decodedData.email !== queryEmail) {
				return res.status(403).send({ message: "Email Dismatched" })
			}
			const result = await BookingSCollections.find({ email: queryEmail }).toArray();
			res.send(result);
		});

		// Adding User to Database from AuthProvider (Public)
		app.post('/alluser', async (req, res) => {
			const UserData = req.body;
			const UserType = (UserData.email === "tanjimulislamsabbir02@gmail.com" || UserData.email === "tanzimulislamsabbir@gmail.com" || UserData.email === "tanzimulislamsabbir@hotmail.com" ||
				UserData.email === "tanjimulislamsabbir01@gmail.com") ? "Admin" : "Regular";
			const EmailFinding = await AllUserCollections.find({ email: UserData.email }).toArray();
			const UserInfo = {
				displayName: UserData?.displayName,
				photoURL: UserData?.photoURL,
				email: UserData?.email,
				userType: UserType
			};
			if (EmailFinding.length) {
				return res.status(409).send({ message: 'user already added' })
			}
			const result = await AllUserCollections.insertOne(UserInfo);
			return res.send(result);

		})
		// Get All User from Dashboard (Admin)
		app.get('/alluser', VerifyJWT, async (req, res) => {
			const decoded = req.decoded;
			const userEmail = req.query.email
			if (decoded.email !== userEmail) {
				return res.status(403).send({ message: "Unauthrized Access email Dismatched" })
			}
			const UserData = await AllUserCollections.find().toArray();
			res.send(UserData);
		});
		// User Delete from Dashboard/AllUser (Admin)
		app.delete('/alluser/:id', VerifyJWT, async (req, res) => {
			const userEmail = req.body.email;
			const queryId = req.params.id;
			if (userEmail === req.decoded.email) {
				const isUser = await AllUserCollections.find({ email: userEmail }).toArray();
				if (isUser.length) {
					const IsAdmin = isUser.find(user => user.userType === "Admin");
					if (IsAdmin) {
						const deleteId = await AllUserCollections.deleteOne({ _id: ObjectId(String(queryId)) });
						if (deleteId.acknowledged) {
							return res.status(204).send({ message: deleteId })
						}

					}
				}
			}

			return res.status(401).send({ message: 'Unauthorized Access' })
		})
	}
	finally {
	}
}
run().catch(console.dir)

app.get("/", (req, res) => {
	res.send("Doctor Portal Server is Running");
})