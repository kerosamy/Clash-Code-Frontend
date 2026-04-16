import { useEffect, useRef, useState } from "react";
import Board from "../components/common/Board";
import ProblemRow, { type ProblemRowProps } from "../components/common/ProblemRow";
import { fetchProblems, fetchFilteredProblems, searchProblemsByTitle } from "../services/ProblemService";
import { mapProblemDtoToProblemRow } from "../utils/mapProblemDtoToProblemRow";
import TagsMultiSelectDropdown from "../components/common/TagsMultiSelectDropDown";
import { TagsFrontendValues, mapFrontendTagsToEnum } from "../utils/mapTags";
import DifficultySelector from "../components/common/DifficultySelector";
import { DifficultyLevel } from "../enums/DifficultyLevel";
import SearchBar from "../components/common/SearchBar";
import React from "react";
import { useNavigate } from "react-router-dom";
import { waitForLoader } from "../components/Loader/WaitLoader";
import LogoLoader from "../components/Loader/LogoLoader";

export default function Practice() {
  const [problems, setProblems] = useState<ProblemRowProps[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [minDifficulty, setMinDifficulty] = useState<number>(DifficultyLevel.MIN);
  const [maxDifficulty, setMaxDifficulty] = useState<number>(DifficultyLevel.HARD_MAX);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const isFirstLoad = useRef(true);
  const navigate = useNavigate();

  async function loadProblems(pageToLoad = 0) {
    // ✅ Only show loader on first page open
    if (isFirstLoad.current) {
      setLoading(true);
    }

    const startTime = Date.now();

    try {
      if (searchQuery.trim() !== "") {
        const backendPage = await searchProblemsByTitle(searchQuery, pageToLoad, 20);
        await waitForLoader(startTime);
        const mapped = backendPage.content.map(mapProblemDtoToProblemRow);
        setProblems(mapped);
        setPage(pageToLoad);
        setTotalPages(backendPage.totalPages);
      } else {
        const backendTags = mapFrontendTagsToEnum(selectedTags);
        const minRate = minDifficulty;
        const maxRate = maxDifficulty;

        const backendPage =
          backendTags.length > 0 ||
          minRate !== DifficultyLevel.MIN ||
          maxRate !== DifficultyLevel.HARD_MAX
            ? await fetchFilteredProblems(backendTags, minRate, maxRate, pageToLoad, 20)
            : await fetchProblems(pageToLoad, 20);

        await waitForLoader(startTime);

        const mapped = backendPage.content.map(mapProblemDtoToProblemRow);
        setProblems(mapped);
        setPage(pageToLoad);
        setTotalPages(backendPage.totalPages);
      }
    } catch (err) {
      console.error("Failed to fetch problems", err);
    } finally {
      if (isFirstLoad.current) {
        setLoading(false);
        isFirstLoad.current = false;
      }
    }
  }

  useEffect(() => {
    loadProblems();
  }, [selectedTags, minDifficulty, maxDifficulty, searchQuery]);

  const handleProblemClick = (problem: ProblemRowProps) => {
    navigate(`/practice/problem/${problem.id}`);
  };

  const handlePrevPage = () => {
    if (page > 0) loadProblems(page - 1);
  };

  const handleNextPage = () => {
    if (page < totalPages - 1) loadProblems(page + 1);
  };

  // ✅ Same pattern as LeaderBoard
  if (loading) {
    return (
      <div className="flex flex-col h-screen font-anta">
        <LogoLoader loadingMessage="Loading Problems" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[90vh] space-y-4 p-scroll-x">
      <div className="flex items-center justify-between flex-wrap space-y-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by problem name"
        />
        <TagsMultiSelectDropdown
          label="Choose Problem Tags"
          options={TagsFrontendValues}
          value={selectedTags}
          onChange={setSelectedTags}
        />
        <DifficultySelector
          min={minDifficulty}
          max={maxDifficulty}
          onMinChange={setMinDifficulty}
          onMaxChange={setMaxDifficulty}
        />
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-white/5 bg-sidebar/10 shadow-xl">
        <div className="h-full overflow-y-auto custom-scroll">
          <Board<ProblemRowProps>
            data={problems}
            columns={["#", "Name", "Tags", "Diff", "#Solvers", "Stat"]}
            onRowClick={handleProblemClick}
            renderRow={(problem, onClick) => (
              <ProblemRow
                key={problem.id}
                {...problem}
                onClick={onClick}
                className="cursor-pointer"
              />
            )}
          />
        </div>
      </div>

      <div className="flex justify-center gap-4">
        <button
          onClick={handlePrevPage}
          disabled={page === 0}
          className="px-5 py-2 bg-sidebar/50 border border-white/10 text-white rounded-full hover:bg-orange hover:border-orange disabled:opacity-30 disabled:hover:bg-sidebar/50 disabled:hover:border-white/10 disabled:cursor-not-allowed transition-all duration-300 font-anta text-sm"
        >
          Previous
        </button>
        <span className="flex items-center text-text/80 font-anta text-sm bg-sidebar/30 px-4 rounded-full border border-white/5">
          Page {page + 1} of {totalPages}
        </span>
        <button
          onClick={handleNextPage}
          disabled={page >= totalPages - 1}
          className="px-5 py-2 bg-sidebar/50 border border-white/10 text-white rounded-full hover:bg-orange hover:border-orange disabled:opacity-30 disabled:hover:bg-sidebar/50 disabled:hover:border-white/10 disabled:cursor-not-allowed transition-all duration-300 font-anta text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}