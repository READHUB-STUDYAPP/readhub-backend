import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * Somebody telling an administrator that something is wrong.
 *
 * The reported content is copied in rather than referenced. A report whose
 * evidence is a pointer is worthless the moment the author deletes the message
 * -- which is exactly what someone who has just been reported tends to do. The
 * snapshot is what an administrator actually reviews.
 */

export type ReportReason =
  | 'harassment'
  | 'spam'
  | 'inappropriate-content'
  | 'impersonation'
  | 'underage-safety'
  | 'other'

export type ReportStatus = 'open' | 'reviewing' | 'actioned' | 'dismissed'

export type ReportSurface = 'buddy-profile' | 'buddy-message' | 'buddy-space'

export const REPORT_REASONS: ReportReason[] = [
  'harassment',
  'spam',
  'inappropriate-content',
  'impersonation',
  'underage-safety',
  'other',
]

export interface IUserReport extends Document {
  reporter: Types.ObjectId
  reported: Types.ObjectId
  surface: ReportSurface
  reason: ReportReason
  details?: string
  /** What was being looked at, copied at report time. */
  evidence?: string
  /** The row it came from, for context when it still exists. */
  sourceId?: Types.ObjectId
  status: ReportStatus
  reviewedBy?: Types.ObjectId
  reviewedAt?: Date
  /** What the administrator did, in their own words. */
  resolution?: string
  createdAt: Date
  updatedAt: Date
}

const userReportSchema = new Schema<IUserReport>(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reported: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    surface: {
      type: String,
      enum: ['buddy-profile', 'buddy-message', 'buddy-space'],
      required: true,
    },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, trim: true, maxlength: 1000 },
    evidence: { type: String, trim: true, maxlength: 2000 },
    sourceId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ['open', 'reviewing', 'actioned', 'dismissed'], default: 'open' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    resolution: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
)

// The moderation queue: open reports, oldest first, because the oldest
// complaint is the one that has been waiting longest.
userReportSchema.index({ status: 1, createdAt: 1 })

// Everything filed against one person, which is how a pattern becomes visible.
userReportSchema.index({ reported: 1, createdAt: -1 })

// One open report per person per surface, so repeatedly tapping Report does not
// bury the queue under copies of one complaint.
userReportSchema.index(
  { reporter: 1, reported: 1, surface: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)

const UserReport: Model<IUserReport> = mongoose.model<IUserReport>('UserReport', userReportSchema)

export default UserReport
