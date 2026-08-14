import Alert from "@mui/joy/Alert";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import CircularProgress from "@mui/joy/CircularProgress";
import DialogContent from "@mui/joy/DialogContent";
import DialogTitle from "@mui/joy/DialogTitle";
import IconButton from "@mui/joy/IconButton";
import Input from "@mui/joy/Input";
import Modal from "@mui/joy/Modal";
import ModalClose from "@mui/joy/ModalClose";
import ModalDialog from "@mui/joy/ModalDialog";
import Option from "@mui/joy/Option";
import Select from "@mui/joy/Select";
import Sheet from "@mui/joy/Sheet";
import Stack from "@mui/joy/Stack";
import Table from "@mui/joy/Table";
import Typography from "@mui/joy/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import SearchIcon from "@mui/icons-material/Search";
import moment from "moment";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FunctionComponent,
} from "react";
import {
  getBackgroundTasksStatus,
  retryPostProcessJobs,
  type BackgroundTasksStatus,
  type PostProcessJobState,
  type PostProcessJobStatus,
  type PostProcessKind,
  type RecordingPostProcessJobs,
} from "../api";
import { formatRecordingTime, parsePairIdTime } from "../utils/recording-time";

interface BackgroundTasksModalProps {
  open: boolean;
  onClose: () => void;
  onRefreshRecordings: () => void;
}

type RecordingFilter = "all" | "active" | "attention";
type Notice = { color: "success" | "warning"; message: string };

const MAX_VISIBLE_RECORDINGS = 100;
const PROCESS_LABELS: Record<PostProcessKind, string> = {
  "overlay-ocr": "Camera overlay OCR",
  "audio-events": "Saving beep detection",
  "gps-extraction": "GPS extraction",
};
const PROCESS_KINDS = Object.keys(PROCESS_LABELS) as PostProcessKind[];

function formatPairId(id: string): string {
  const timestamp = parsePairIdTime(id);
  return timestamp === null ? id : formatRecordingTime(timestamp);
}

function statePresentation(state: PostProcessJobState): {
  label: string;
  color: "success" | "neutral" | "warning" | "danger" | "primary";
} {
  switch (state) {
    case "completed":
      return { label: "Completed", color: "success" };
    case "no-data":
      return { label: "No data", color: "neutral" };
    case "queued":
      return { label: "Queued", color: "warning" };
    case "running":
      return { label: "Running", color: "primary" };
    case "failed":
      return { label: "Failed", color: "danger" };
    case "disabled":
      return { label: "Disabled", color: "neutral" };
    case "unavailable":
      return { label: "Unavailable", color: "danger" };
    case "not-processed":
      return { label: "Not processed", color: "warning" };
  }
}

function JobCell({
  recordingId,
  kind,
  job,
  retrying,
  onRetry,
}: Readonly<{
  recordingId: string;
  kind: PostProcessKind;
  job: PostProcessJobStatus;
  retrying: boolean;
  onRetry: (id: string, kind: PostProcessKind) => void;
}>) {
  const presentation = statePresentation(job.state);
  const label = PROCESS_LABELS[kind];
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Chip size="sm" color={presentation.color} variant="soft">
          {presentation.label}
        </Chip>
        <Typography
          level="body-xs"
          color="neutral"
          title={job.message}
          sx={{ mt: 0.35 }}>
          {job.message}
        </Typography>
        {job.updatedAt && (
          <Typography level="body-xs" color="neutral">
            {moment(job.updatedAt).fromNow()}
          </Typography>
        )}
      </Box>
      <IconButton
        size="sm"
        variant="plain"
        color="neutral"
        loading={retrying}
        disabled={!job.retryable || retrying}
        aria-label={`Retry ${label} for ${formatPairId(recordingId)}`}
        title={job.retryable ? `Retry ${label}` : job.message}
        onClick={() => onRetry(recordingId, kind)}>
        <ReplayIcon />
      </IconButton>
    </Box>
  );
}

function JobSummary({
  title,
  kind,
  recordings,
  detail,
}: Readonly<{
  title: string;
  kind: PostProcessKind;
  recordings: readonly RecordingPostProcessJobs[];
  detail: string;
}>) {
  const jobs = recordings.map((recording) => recording.jobs[kind]);
  const active = jobs.filter(
    (job) => job.state === "queued" || job.state === "running",
  ).length;
  const failed = jobs.filter((job) => job.state === "failed").length;
  const pending = jobs.filter((job) => job.state === "not-processed").length;
  const completed = jobs.filter(
    (job) => job.state === "completed" || job.state === "no-data",
  ).length;
  const blocked = jobs.filter(
    (job) => job.state === "disabled" || job.state === "unavailable",
  ).length;
  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 1.5 }}>
      <Typography level="title-sm">{title}</Typography>
      <Typography level="body-xs" color="neutral" sx={{ mb: 1 }}>
        {detail}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        <Chip
          size="sm"
          color={completed ? "success" : "neutral"}
          variant="soft">
          Done: {completed}
        </Chip>
        <Chip size="sm" color={active ? "primary" : "neutral"} variant="soft">
          Active: {active}
        </Chip>
        <Chip size="sm" color={pending ? "warning" : "neutral"} variant="soft">
          Not processed: {pending}
        </Chip>
        <Chip size="sm" color={failed ? "danger" : "neutral"} variant="soft">
          Failed: {failed}
        </Chip>
        <Chip size="sm" color={blocked ? "danger" : "neutral"} variant="soft">
          Blocked: {blocked}
        </Chip>
      </Box>
    </Sheet>
  );
}

function needsAttention(recording: RecordingPostProcessJobs): boolean {
  return Object.values(recording.jobs).some((job) =>
    ["not-processed", "failed", "disabled", "unavailable"].includes(job.state),
  );
}

const BackgroundTasksModal: FunctionComponent<BackgroundTasksModalProps> = ({
  open,
  onClose,
  onRefreshRecordings,
}) => {
  const [status, setStatus] = useState<BackgroundTasksStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RecordingFilter>("all");

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getBackgroundTasksStatus());
      setError(null);
    } catch (refreshError) {
      console.error("Failed to load background task status:", refreshError);
      setError("Could not load background task status.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 1_000);
    return () => window.clearInterval(interval);
  }, [open, refreshStatus]);

  const filteredRecordings = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (status?.recordings ?? []).filter((recording) => {
      if (
        needle &&
        !recording.id.toLowerCase().includes(needle) &&
        !formatPairId(recording.id).toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (filter === "active") {
        return Object.values(recording.jobs).some(
          (job) => job.state === "queued" || job.state === "running",
        );
      }
      if (filter === "attention") return needsAttention(recording);
      return true;
    });
  }, [filter, search, status?.recordings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshStatus();
    onRefreshRecordings();
    setRefreshing(false);
  };

  const handleRetry = async (
    id: string,
    requested: PostProcessKind | "all",
  ) => {
    const key = `${id}:${requested}`;
    setRetrying((current) => new Set(current).add(key));
    setNotice(null);
    try {
      const result = await retryPostProcessJobs(id, requested);
      const selected =
        requested === "all"
          ? PROCESS_KINDS.map((kind) => result.results[kind])
          : [result.results[requested]];
      const rejected = selected.filter((item) => !item.accepted);
      setNotice({
        color: rejected.length ? "warning" : "success",
        message: rejected.length
          ? `Available jobs were queued. ${rejected.map((item) => item.message).join("; ")}`
          : "Job queued.",
      });
      await refreshStatus();
    } catch (retryError) {
      console.error("Failed to retry post-processing job:", retryError);
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Could not retry post-processing job.",
      );
    } finally {
      setRetrying((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleClose = () => {
    onRefreshRecordings();
    onClose();
  };

  const visibleRecordings = filteredRecordings.slice(0, MAX_VISIBLE_RECORDINGS);

  return (
    <Modal open={open} onClose={handleClose} sx={{ zIndex: 11000 }}>
      <ModalDialog
        sx={{
          width: "min(1240px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          overflow: "hidden",
        }}>
        <ModalClose />
        <DialogTitle>Post-processing jobs</DialogTitle>
        <DialogContent sx={{ overflowX: "hidden" }}>
          <Stack spacing={2}>
            <Box
              sx={{
                display: "flex",
                gap: 1,
                alignItems: "center",
                flexWrap: "wrap",
              }}>
              <Input
                size="sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find recording"
                startDecorator={<SearchIcon />}
                sx={{ flex: "1 1 260px" }}
              />
              <Select
                size="sm"
                value={filter}
                onChange={(_, value) => value && setFilter(value)}
                sx={{ minWidth: 170 }}>
                <Option value="all">All recordings</Option>
                <Option value="active">Active jobs</Option>
                <Option value="attention">Needs attention</Option>
              </Select>
              <Button
                size="sm"
                variant="outlined"
                startDecorator={<RefreshIcon />}
                loading={refreshing}
                onClick={() => void handleRefresh()}>
                Refresh
              </Button>
            </Box>

            {error && <Alert color="danger">{error}</Alert>}
            {notice && <Alert color={notice.color}>{notice.message}</Alert>}
            {!status && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress />
              </Box>
            )}

            {status && (
              <>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      md: "repeat(3, minmax(0, 1fr))",
                    },
                    gap: 1,
                  }}>
                  <JobSummary
                    title="Camera overlay OCR"
                    kind="overlay-ocr"
                    recordings={status.recordings}
                    detail={`${status.overlayOcr.message} · concurrency ${status.overlayOcr.limit}`}
                  />
                  <JobSummary
                    title="Saving beep detection"
                    kind="audio-events"
                    recordings={status.recordings}
                    detail={`${status.audioEvents.enabled ? "Enabled" : "Disabled"} · concurrency ${status.audioEvents.limit}`}
                  />
                  <JobSummary
                    title="GPS extraction"
                    kind="gps-extraction"
                    recordings={status.recordings}
                    detail={`Concurrency ${status.gpsExtraction.limit}`}
                  />
                </Box>

                <Sheet
                  variant="outlined"
                  sx={{ borderRadius: "md", overflow: "auto" }}>
                  <Table
                    size="sm"
                    stickyHeader
                    hoverRow
                    sx={{ minWidth: 1040, tableLayout: "fixed" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 175 }}>Recording</th>
                        <th>Camera overlay OCR</th>
                        <th>Saving beep detection</th>
                        <th>GPS extraction</th>
                        <th style={{ width: 105 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRecordings.map((recording) => (
                        <tr key={recording.id}>
                          <td>
                            <Typography level="title-sm">
                              {formatPairId(recording.id)}
                            </Typography>
                            <Typography level="body-xs" color="neutral">
                              {recording.id}
                            </Typography>
                          </td>
                          {PROCESS_KINDS.map((kind) => (
                            <td key={kind}>
                              <JobCell
                                recordingId={recording.id}
                                kind={kind}
                                job={recording.jobs[kind]}
                                retrying={retrying.has(
                                  `${recording.id}:${kind}`,
                                )}
                                onRetry={(id, selectedKind) =>
                                  void handleRetry(id, selectedKind)
                                }
                              />
                            </td>
                          ))}
                          <td>
                            <Button
                              size="sm"
                              variant="outlined"
                              startDecorator={<ReplayIcon />}
                              loading={retrying.has(`${recording.id}:all`)}
                              disabled={
                                !Object.values(recording.jobs).some(
                                  (job) => job.retryable,
                                )
                              }
                              aria-label={`Run all post-processing jobs for ${formatPairId(recording.id)}`}
                              onClick={() =>
                                void handleRetry(recording.id, "all")
                              }>
                              Run all
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Sheet>

                {visibleRecordings.length === 0 && (
                  <Typography level="body-sm" color="neutral">
                    No recordings match the current filters.
                  </Typography>
                )}
                {filteredRecordings.length > visibleRecordings.length && (
                  <Typography level="body-xs" color="neutral">
                    Showing the first {visibleRecordings.length} of{" "}
                    {filteredRecordings.length} recordings. Refine the search to
                    find a specific recording.
                  </Typography>
                )}

                <Sheet variant="outlined" sx={{ borderRadius: "md", p: 1.5 }}>
                  <Typography level="title-sm">
                    Recent clip generation jobs
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.75,
                      mt: 1,
                    }}>
                    <Chip size="sm" variant="soft">
                      Active:{" "}
                      {
                        status.clipJobs.filter((job) => job.state === "running")
                          .length
                      }
                    </Chip>
                    <Chip size="sm" color="danger" variant="soft">
                      Failed:{" "}
                      {
                        status.clipJobs.filter((job) => job.state === "failed")
                          .length
                      }
                    </Chip>
                    <Chip size="sm" variant="outlined">
                      Recent: {status.clipJobs.length}
                    </Chip>
                  </Box>
                </Sheet>
              </>
            )}
          </Stack>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
};

export default BackgroundTasksModal;
