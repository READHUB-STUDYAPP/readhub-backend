import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import morgan from 'morgan'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import swaggerUi from 'swagger-ui-express'
import swaggerSpec from './config/swagger.js'
import connectDB from './config/db.js'
import { sanitizeBody } from './middlewares/sanitize.js'
import authRoutes from './routes/auth.routes.js'
import userProfile from './routes/userProfile.route.js'
import cloudinaryRoutes from './routes/cloudinary-uploads.route.js'
import waitList from './routes/waitlist.route.js'
import bookRoutes from './routes/book.route.js'
import noteRoutes from './routes/notes.route.js'
import adminRoutes from './routes/admin.route.js'

dotenv.config()

const app = express()

// Middleware
const allowedOrigin = [
  process.env.FRONTEND_URL,
  process.env.WAITLIST_URL,
  process.env.DEVELOPMENT_TEST,
].filter((origin): origin is string => Boolean(origin))

// Security headers. CSP is disabled to avoid interfering with the Swagger UI
// assets served at /api-docs; all other hardening headers still apply.
app.use(helmet({ contentSecurityPolicy: false }))
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  }),
)
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(sanitizeBody)
app.use(cookieParser())
app.use(morgan('dev'))

// Test route
app.get('/', (_req, res) => {
  res.send('Welcome to ReadHub API')
})

// Routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
app.use('/api/auth', authRoutes)
app.use('/api/profile', userProfile)
app.use('/api/cloudinary-signature', cloudinaryRoutes)
app.use('/api/waitlist', waitList)
app.use('/api/book', bookRoutes)
app.use('/api/notes', noteRoutes)
app.use('/api/admin', adminRoutes)

const PORT = process.env.PORT || 5000

app.listen(PORT, async () => {
  await connectDB()
  console.log(`Server is running on port ${PORT}`)
})
