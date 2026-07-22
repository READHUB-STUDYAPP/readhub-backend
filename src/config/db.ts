import mongoose from 'mongoose'

const connectDB = async (): Promise<void> => {
  try {
    console.log('Attempting to connect to MongoDB...')
    await mongoose.connect(process.env.MONGODB_URI as string)
    console.log('MongoDB connection successful')
  } catch (error) {
    console.error(
      'MongoDB connection error:',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  }
}

export default connectDB
