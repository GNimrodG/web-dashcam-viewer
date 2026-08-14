import Alert from "@mui/joy/Alert";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import CircularProgress from "@mui/joy/CircularProgress";
import DialogContent from "@mui/joy/DialogContent";
import DialogTitle from "@mui/joy/DialogTitle";
import IconButton from "@mui/joy/IconButton";
import Input from "@mui/joy/Input";
import LinearProgress from "@mui/joy/LinearProgress";
import Modal from "@mui/joy/Modal";
import ModalClose from "@mui/joy/ModalClose";
import ModalDialog from "@mui/joy/ModalDialog";
import Option from "@mui/joy/Option";
import Select from "@mui/joy/Select";
import Sheet from "@mui/joy/Sheet";
import Stack from "@mui/joy/Stack";
import Switch from "@mui/joy/Switch";
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
  type PostProcessJobStatus,
  type PostProcessKind,
} from "../api";
import { formatRecordingTime, parsePairIdTime } from "../utils/recording-time";
import {
  comparePostProcessJobsByExecutionOrder,
  flattenPostProcessJobs,
  isFinishedPostProcessJob,
} from "../utils/post-process-job-list";
import {
  getPostProcessStatePresentation,
  POST_PROCESS_KINDS,
  POST_PROCESS_LABELS,
} from "../utils/post-process-jobs";

interface BackgroundTasksModalProps {
  open: boolean;
  onClose: () => void;
  onRefreshRecordings: () => void;
}

type JobFilter = "unfinished" | "active" | "attention" | "finished" | "all";
type Notice = { color: "success" | "warning"; message: string };

const MAX_VISIBLE_JOBS = 300;
function formatPairId(id: string): string {
  const timestamp = parsePairIdTime(id);
  return timestamp === null ? id : formatRecordingTime(timestamp);
}

function needsAttention(job: PostProcessJobStatus): boolean {
  return ["not-processed", "failed", "disabled", "unavailable"].includes(
    job.state,
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
  const [filter, setFilter] = useState<JobFilter>("unfinished");
  const [autoRefresh, setAutoRefresh] = useState(true);

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
  }, [open, refreshStatus]);

  useEffect(() => {
    if (!open || !autoRefresh) return;
    const interval = window.setInterval(() => void refreshStatus(), 1_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, open, refreshStatus]);

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return flattenPostProcessJobs(status?.recordings ?? [])
      .filter((row) => {
        const taskLabel = POST_PROCESS_LABELS[row.kind];
        const stateLabel = getPostProcessStatePresentation(row.job.state).label;
        if (
          needle &&
          !row.recordingId.toLowerCase().includes(needle) &&
          !formatPairId(row.recordingId).toLowerCase().includes(needle) &&
          !taskLabel.toLowerCase().includes(needle) &&
          !stateLabel.toLowerCase().includes(needle) &&
          !row.job.message.toLowerCase().includes(needle)
        ) {
          return false;
        }
        if (filter === "unfinished") return !isFinishedPostProcessJob(row.job);
        if (filter === "finished") return isFinishedPostProcessJob(row.job);
        if (filter === "active") {
          return row.job.state === "queued" || row.job.state === "running";
        }
        if (filter === "attention") return needsAttention(row.job);
        return true;
      })
      .sort(comparePostProcessJobsByExecutionOrder);
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
          ? POST_PROCESS_KINDS.map((kind) => result.results[kind])
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

  const visibleJobs = filteredJobs.slice(0, MAX_VISIBLE_JOBS);

  return (
    <Modal open={open} onClose={handleClose} sx={{ zIndex: 11000 }}>
      <ModalDialog
        sx={{
          width: "min(1240px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          overflow: "hidden",
        }}>
        <ModalClose />
        <DialogTitle sx={{ pr: 4 }}>Post-processing jobs</DialogTitle>
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
                placeholder="Find recording or task"
                startDecorator={<SearchIcon />}
                sx={{ flex: "1 1 260px" }}
              />
              <Select
                size="sm"
                value={filter}
                onChange={(_, value) => value && setFilter(value)}
                sx={{ minWidth: 170 }}
                slotProps={{
                  listbox: {
                    sx: {
                      zIndex: 11001,
                    },
                  },
                }}>
                <Option value="unfinished">Unfinished jobs</Option>
                <Option value="active">Queued or running</Option>
                <Option value="attention">Needs attention</Option>
                <Option value="finished">Finished jobs</Option>
                <Option value="all">All jobs</Option>
              </Select>
              <Switch
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                startDecorator={
                  <Typography level="body-sm">Auto-refresh</Typography>
                }
              />
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
                <Sheet
                  variant="outlined"
                  sx={{
                    borderRadius: "md",
                    maxHeight: "min(60dvh, 720px)",
                    overflow: "auto",
                  }}>
                  <Table
                    size="sm"
                    stickyHeader
                    hoverRow
                    sx={{ minWidth: 940, tableLayout: "fixed", ["."]: {} }}>
                    <thead>
                      <tr>
                        <th style={{ width: 175 }}>Recording</th>
                        <th style={{ width: 175 }}>Task</th>
                        <th style={{ width: 120 }}>Status</th>
                        <th>Details</th>
                        <th style={{ width: 120 }}>Updated</th>
                        <th style={{ width: 70 }}>Retry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleJobs.map(({ recordingId, kind, job }) => {
                        const presentation = getPostProcessStatePresentation(
                          job.state,
                        );
                        const taskLabel = POST_PROCESS_LABELS[kind];
                        const retryKey = `${recordingId}:${kind}`;
                        return (
                          <tr key={retryKey}>
                            <td>
                              <Typography level="title-sm">
                                {formatPairId(recordingId)}
                              </Typography>
                              <Typography level="body-xs" color="neutral">
                                {recordingId}
                              </Typography>
                            </td>
                            <td>
                              <Typography level="title-sm">
                                {taskLabel}
                              </Typography>
                            </td>
                            <td>
                              <Chip
                                size="sm"
                                color={presentation.color}
                                variant="soft">
                                {presentation.label}
                              </Chip>
                            </td>
                            <td>
                              <Stack spacing={0.5}>
                                <Typography level="body-sm" title={job.message}>
                                  {job.message}
                                </Typography>
                                {job.progress && (
                                  <Box
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 1,
                                    }}>
                                    <LinearProgress
                                      determinate
                                      value={job.progress.percent}
                                      sx={{ flex: 1, minWidth: 80 }}
                                      aria-label={`${taskLabel} progress`}
                                    />
                                    <Typography
                                      level="body-xs"
                                      color="neutral"
                                      sx={{ whiteSpace: "nowrap" }}>
                                      {job.progress.current}/
                                      {job.progress.total} (
                                      {job.progress.percent}
                                      %)
                                    </Typography>
                                  </Box>
                                )}
                              </Stack>
                            </td>
                            <td>
                              <Typography level="body-xs" color="neutral">
                                {job.updatedAt
                                  ? moment(job.updatedAt).fromNow()
                                  : "—"}
                              </Typography>
                            </td>
                            <td>
                              <IconButton
                                size="sm"
                                variant="plain"
                                color="neutral"
                                loading={retrying.has(retryKey)}
                                disabled={
                                  !job.retryable || retrying.has(retryKey)
                                }
                                aria-label={`Retry ${taskLabel} for ${formatPairId(recordingId)}`}
                                title={
                                  job.retryable
                                    ? `Retry ${taskLabel}`
                                    : job.message
                                }
                                onClick={() =>
                                  void handleRetry(recordingId, kind)
                                }>
                                <ReplayIcon />
                              </IconButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </Sheet>

                {visibleJobs.length === 0 && (
                  <Typography level="body-sm" color="neutral">
                    No jobs match the current filters.
                  </Typography>
                )}
                {filteredJobs.length > visibleJobs.length && (
                  <Typography level="body-xs" color="neutral">
                    Showing the first {visibleJobs.length} of{" "}
                    {filteredJobs.length} jobs. Refine the search to find a
                    specific job.
                  </Typography>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
};

export default BackgroundTasksModal;
